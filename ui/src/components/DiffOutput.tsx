import { ToolText } from "./ToolOutput"

/** Diff lines are literal code; their Markdown and HTML never become UI nodes. */
export const DiffOutput = ({ source }: { source: string }) => <ToolText text={source} language="diff" />
