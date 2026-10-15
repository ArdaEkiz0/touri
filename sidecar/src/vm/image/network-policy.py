#!/usr/bin/python3
"""Root-owned packet policy and bounded local DNS forwarder. No workload configuration."""
import ipaddress
import json
import os
import selectors
import socket
import struct
import subprocess
import sys
import threading

CONFIG = '/run/touri-network.json'
PRIVATE4 = '0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.0.0.0/24, 192.0.2.0/24, 192.168.0.0/16, 198.18.0.0/15, 198.51.100.0/24, 203.0.113.0/24, 224.0.0.0/4, 240.0.0.0/4'
PRIVATE6 = '::/96, ::ffff:0:0/96, 64:ff9b::/96, 64:ff9b:1::/48, 100::/64, 2001::/23, 2001:db8::/32, 2002::/16, fc00::/7, fe80::/10, ff00::/8'
SUFFIXES = ('localhost', 'local', 'lan', 'home', 'internal', 'intranet', 'corp', 'test', 'invalid', 'home.arpa')

def apply(policy, blocked=False):
    # Discover the host-facing router; LAN consent never grants access to the host.
    routes = json.loads(subprocess.check_output(['ip', '-j', 'route', 'show', 'default']))
    gateways = [str(ipaddress.IPv4Address(r['gateway'])) for r in routes if r.get('gateway')]
    lines = ['table inet touri {', 'chain output { type filter hook output priority -150; policy drop;']
    lines += ['meta skuid 1000 tcp dport { 5900, 9222 } drop', 'meta skuid 1001 tcp dport { 9876, 5900 } drop', 'oifname "lo" accept']
    # Only the root resolver may send conventional DNS to configured upstreams.
    for resolver in policy['resolvers']:
        address = ipaddress.ip_address(resolver)
        family = 'ip' if address.version == 4 else 'ip6'
        lines += [f'meta skuid 0 {family} daddr {address} udp dport 53 accept', f'meta skuid 0 {family} daddr {address} tcp dport 53 accept']
    lines += ['udp dport { 53, 853 } drop', 'tcp dport { 53, 853 } drop']
    # Link-local/metadata and the host/router stay denied even with LAN enabled.
    lines += ['ip daddr 169.254.0.0/16 drop', 'ip6 daddr fe80::/10 drop']
    for gateway in gateways:
        lines.append(f'ip daddr {gateway} drop')
    for host in policy.get('hostAddresses', []):
        address = ipaddress.ip_address(host)
        lines.append(f'{"ip" if address.version == 4 else "ip6"} daddr {address} drop')
    if not policy['allowLan']:
        lines += [f'ip daddr {{ {PRIVATE4} }} drop', f'ip6 daddr {{ {PRIVATE6} }} drop']
    else:
        lines += ['ip daddr { 0.0.0.0/8, 127.0.0.0/8, 224.0.0.0/4, 240.0.0.0/4 } drop', 'ip6 daddr { ::/96, ::ffff:0:0/96, 64:ff9b::/96, 64:ff9b:1::/48, 2002::/16, ff00::/8 } drop']
    if not blocked:
        lines.append('accept')
    lines += ['}', 'chain input { type filter hook input priority -150; policy drop; iifname "lo" accept; ct state established,related accept; }', '}']
    # nft applies the whole transaction atomically, including established flows.
    exists = subprocess.run(['nft', 'list', 'table', 'inet', 'touri'], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
    script = ('delete table inet touri\n' if exists else '') + '\n'.join(lines) + '\n'
    subprocess.run(['nft', '-f', '-'], input=script.encode(), check=True)
    fd = os.open(CONFIG + '.tmp', os.O_WRONLY | os.O_CREAT | os.O_TRUNC | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump(policy, out); out.flush(); os.fsync(out.fileno())
    os.replace(CONFIG + '.tmp', CONFIG)
    with open('/etc/resolv.conf', 'w') as out:
        out.write('nameserver 127.0.0.53\noptions timeout:2 attempts:1\n')

def permitted_question(packet, policy):
    if len(packet) < 17 or packet[4:6] != b'\x00\x01':
        return False
    at, labels = 12, []
    while at < len(packet):
        length = packet[at]; at += 1
        if length == 0:
            break
        if length > 63 or at + length > len(packet):
            return False
        labels.append(packet[at:at+length].decode('ascii').lower()); at += length
    else:
        return False
    name = '.'.join(labels)
    if len(labels) < 2 or at + 4 != len(packet):
        return False
    if any(name == suffix or name.endswith('.' + suffix) for suffix in SUFFIXES + tuple(policy['privateDomains'])):
        return False
    if name.endswith('.in-addr.arpa') or name.endswith('.ip6.arpa'):
        return False
    return True

def query(packet):
    try:
        with open(CONFIG) as stream:
            policy = json.load(stream)
        if permitted_question(packet, policy):
            for resolver in policy['resolvers']:
                with socket.socket(socket.AF_INET6 if ':' in resolver else socket.AF_INET, socket.SOCK_DGRAM) as upstream:
                    upstream.settimeout(2)
                    try:
                        upstream.connect((resolver, 53)); upstream.send(packet)
                        reply = upstream.recv(65535)
                        if reply[:2] == packet[:2]:
                            return reply
                    except OSError:
                        pass
    except (ValueError, OSError, UnicodeError):
        pass
    if len(packet) < 12:
        return b''
    return packet[:2] + b'\x81\x83' + packet[4:6] + b'\x00' * 6 + packet[12:]

def serve():
    udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM); udp.bind(('127.0.0.53', 53))
    tcp = socket.socket(); tcp.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1); tcp.bind(('127.0.0.53', 53)); tcp.listen(16)
    poll = selectors.DefaultSelector(); poll.register(udp, selectors.EVENT_READ); poll.register(tcp, selectors.EVENT_READ)
    slots = threading.BoundedSemaphore(32)
    def handle_udp(packet, peer):
        try:
            reply = query(packet)
            if reply: udp.sendto(reply, peer)
        finally: slots.release()
    def handle_tcp(peer):
        try:
            peer.settimeout(3)
            def read(n):
                data = b''
                while len(data) < n:
                    chunk = peer.recv(n-len(data))
                    if not chunk: raise OSError('closed')
                    data += chunk
                return data
            size = struct.unpack('!H', read(2))[0]
            reply = query(read(size))
            peer.sendall(struct.pack('!H', len(reply)) + reply)
        except OSError: pass
        finally: peer.close(); slots.release()
    while True:
        for event, _ in poll.select():
            if event.fileobj is udp:
                packet, peer = udp.recvfrom(4096)
                if slots.acquire(False): threading.Thread(target=handle_udp, args=(packet, peer), daemon=True).start()
            else:
                peer, _ = tcp.accept()
                if slots.acquire(False): threading.Thread(target=handle_tcp, args=(peer,), daemon=True).start()
                else: peer.close()

if __name__ == '__main__':
    if sys.argv[1] == 'serve': serve()
    elif sys.argv[1] == 'boot': apply(dict(allowLan=False, resolvers=[], privateDomains=[]), blocked=True)
    else: apply(json.loads(sys.argv[2]))
