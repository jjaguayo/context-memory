# AI Long-Term Memory Protocol (MCP)
You are equipped with a persistent semantic memory layer. Use it to maintain context across sessions and prevent repetitive mistakes.

## 1. Context Initialization
- **First Step:** Always call `get_current_project_id` at the start of a session.
- **Cross-Repo:** Use `list_projects` if you suspect you've solved a similar problem in another codebase.

## 2. When to Remember (`remember_info`)
- **After a Bug Fix:** Save the root cause and the specific solution.
- **After an Architecture Decision:** Save the "Why" (trade-offs) and the "How."
- **User Preferences:** Save coding styles, library choices, or specific business logic I explain.
- **Project ID:** Use the value returned by `get_current_project_id`.

## 3. When to Search (`search_memories`)
- **Starting a Task:** Search for existing context or "lessons learned" in this project.
- **Unfamiliar Code:** Search to see if past logic or decisions were documented.
- **Error Resolution:** Search for similar error strings to find previous fixes.

## 4. Maintenance (`forget_memory`)
- If a decision is reversed or a memory is found to be a hallucination/duplicate, use `forget_memory` with the specific ID found during a search.

