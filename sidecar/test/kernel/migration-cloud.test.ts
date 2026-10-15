import { Database } from "bun:sqlite"
import { expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { openDatabase, SCHEMA_VERSION } from "../../src/kernel/db"

test.each([7, 8])("schema %i upgrades to 12 preserving bot, message and group data across reopens", async (version) => {
  const root = mkdtempSync(join(tmpdir(), "touri-cloud-migration-"))
  const filename = join(root, "touri.db")
  let database = new Database(filename)
  try {
    database.exec("PRAGMA foreign_keys = ON")
    for (let n = 1; n <= version; n++)
      database.exec(
        await Bun.file(join(import.meta.dir, `../../src/kernel/migrations/${String(n).padStart(4, "0")}.sql`)).text(),
      )
    database.exec(`
      INSERT INTO bots(id,name,provider,home_dir,machine,created_at,updated_at)
        VALUES ('local','Local','codex','/local','local',1,1), ('vm','VM','claude','/vm','vm',1,1);
      INSERT INTO threads(id,bot_id,title,created_at,updated_at) VALUES ('chat','local','History',1,1);
      INSERT INTO messages(id,thread_id,role,kind,text,created_at,updated_at)
        VALUES ('message','chat','user','text','Keep my history',1,1);
    `)
    const tables = ["bots", "threads", "messages", "runs", "transcript_entries"]
    if (version === 8) {
      database.exec(`
        INSERT INTO bot_groups(id,name,color,avatar_shape,avatar_seed,coordinator_bot_id,created_at,updated_at)
          VALUES ('group','Team','#2468ac','nuage','seed','local',1,1);
        INSERT INTO group_members(group_id,bot_id,position) VALUES ('group','local',0), ('group','vm',1);
        UPDATE threads SET group_id='group' WHERE id='chat';
        INSERT INTO threads(id,bot_id,title,group_id,group_thread_id,created_at,updated_at)
          VALUES ('participant','vm','Session','group','chat',1,1);
        INSERT INTO runs(id,thread_id,bot_id,provider,trigger,status,queued_at)
          VALUES ('turn','chat','local','codex','user','succeeded',1),
            ('child','participant','vm','claude','user','succeeded',1);
        INSERT INTO group_turns(run_id,group_id,recipients_json) VALUES ('turn','group','["vm"]');
        INSERT INTO group_run_links(run_id,turn_id,depth) VALUES ('child','turn',1);
        INSERT INTO group_message_links(message_id,source_thread_id,visible_message_id)
          VALUES ('source','participant','message');
      `)
      tables.push("bot_groups", "group_members", "group_turns", "group_run_links", "group_message_links")
    }
    expect(database.query("SELECT value FROM schema_meta WHERE key='schema_version'").get()).toEqual({
      value: String(version),
    })
    const before = new Map(
      tables.map((table) => [table, database.query(`SELECT * FROM ${table} ORDER BY rowid`).all()]),
    )
    const preserved = () => {
      expect(database.query("SELECT value FROM schema_meta WHERE key='schema_version'").get()).toEqual({
        value: String(SCHEMA_VERSION),
      })
      for (const [table, rows] of before) {
        const columns = Object.keys(rows[0] ?? {})
        const projection = columns.length ? columns.join(",") : "*"
        expect(database.query(`SELECT ${projection} FROM ${table} ORDER BY rowid`).all()).toEqual(rows)
      }
      expect(database.query("SELECT cloud_target FROM bots ORDER BY id").all()).toEqual([
        { cloud_target: 0 },
        { cloud_target: 0 },
      ])
      expect(database.query("SELECT value FROM schema_meta WHERE key='groups_version'").get()).toEqual({ value: "1" })
      expect(database.query("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" })
      expect(database.query("PRAGMA foreign_key_check").all()).toEqual([])
    }
    database.close()
    database = openDatabase({ filename })
    preserved()
    expect(database.query("SELECT * FROM cloud_machines").all()).toEqual([])
    expect(database.query("SELECT * FROM cloud_runs").all()).toEqual([])
    database.exec(`
      INSERT INTO cloud_machines(bot_id,base_url,account_id,machine_id,generation)
        VALUES ('local','https://cloud.example','account','machine',4);
      INSERT INTO cloud_runs(run_id,bot_id) VALUES ('remote','local');
    `)
    database.close()
    database = openDatabase({ filename })
    preserved()
    expect(database.query("SELECT machine_id,generation FROM cloud_machines").get()).toEqual({
      machine_id: "machine",
      generation: 4,
    })
    expect(database.query("SELECT run_id,bot_id FROM cloud_runs").get()).toEqual({ run_id: "remote", bot_id: "local" })
  } finally {
    database.close()
    rmSync(root, { recursive: true, force: true })
  }
})
