---
name: chat-tools
description: >-
  Chat utility tools: memory management, chat history search, long-term memory
  recall, and agent control (think, request_user_input, finalize,
  store_experience). This skill should be used when the AI needs to remember
  user preferences, search conversation history, recall past experiences, pause
  for user input, or mark a task as complete.
license: MIT
compatibility: Requires Tauri v2+
usage: |-
  ## Quick Start

  - **Remember**: agent_memory_update({action: "update", content, importance}) — save user fact
  - **Search history**: search_chat_history({keyword, days?}) — find past conversations
  - **Delete messages**: delete_chat_messages({message_ids, conversation_id?})
  - **Recall**: recall_memory({keyword, type?, days?}) — search long-term memory
  - **Pause for input**: request_user_input({fields, title?, prompt?}) — wait for user response
  - **Think**: think({reasoning}) — record internal reasoning before action
  - **Finalize**: finalize({summary, status?}) — mark task complete
  - **Store experience**: store_experience({type, content, source_task?, success?}) — save for future

tools:
  - name: agent_memory_update
    description: >-
      Update the agent long-term memory. Use this to remember user preferences,
      facts, and important context for future conversations. Records are stored
      as user_profile type and persist permanently.
    parameters:
      type: object
      properties:
        action:
          type: string
          enum: [update, delete]
          description: Action — update (add/update) or delete (remove). Default is update.
        content:
          type: string
          description: Memory content describing the user preference or fact
        reason:
          type: string
          description: Why this memory is important to record
        importance:
          type: number
          description: Importance score 1–10 (default 8)
        memory_id:
          type: string
          description: Required for delete action — the memory ID to remove
    returns: '{"memory":{"id":"...","content":"...","importance":number}}'

  - name: search_chat_history
    description: >-
      Search historical chat messages across all conversations. At least one
      filter (keyword, conversation_id, days, or date) is required.
    parameters:
      type: object
      properties:
        keyword:
          type: string
          description: Search keyword (fuzzy LIKE match)
        conversation_id:
          type: string
          description: Filter by specific conversation ID
        role:
          type: string
          enum: [user, assistant]
          description: Filter by message role
        days:
          type: number
          description: Only include messages from last N days
        date:
          type: string
          description: Search from a specific date, e.g. "2026-06-22"
        date_from:
          type: string
          description: Search from this date onwards
        date_to:
          type: string
          description: Search up to this date
        limit:
          type: number
          description: Max results (default 20, max 50)
    returns: '{"messages":[{"conversation_title":"...","role":"user/assistant","content":"...","timestamp":"..."}],"total":number}'

  - name: delete_chat_messages
    description: >-
      Delete specific chat messages or clear an entire conversation. Use
      message_ids to delete specific messages, or conversation_id + mode=
      "conversation" to clear all messages. Irreversible — use with caution.
    parameters:
      type: object
      properties:
        message_ids:
          type: array
          items:
            type: string
          description: IDs of messages to delete
        conversation_id:
          type: string
          description: Conversation ID to clear (with mode="conversation")
        mode:
          type: string
          enum: [messages, conversation]
          description: '"messages" for specific IDs, "conversation" to clear all'
    returns: '{"deleted_count":number}'

  - name: recall_memory
    description: >-
      Search long-term memory for user profile info, task history, agent
      heuristics, task workflows, and task experiences. Use this to recall
      user preferences, past projects, lessons learned, and reusable patterns.
    parameters:
      type: object
      properties:
        keyword:
          type: string
          description: Search keyword (fuzzy match)
        type:
          type: string
          enum: [user_profile, task_history, agent_heuristic, task_workflow, task_experience, all]
          description: Memory type — all (default) or specific type
        days:
          type: number
          description: Only search recent N days
        limit:
          type: number
          description: Max results (default 10, max 30)
    returns: '{"memories":[{"type":"...","content":"...","importance":number}],"total":number}'

  - name: think
    description: >-
      Record internal reasoning before taking action. Use this to plan
      multi-step tasks, evaluate options, or verify your approach.
    parameters:
      type: object
      properties:
        reasoning:
          type: string
          description: Internal reasoning to record (shown to user in special display)
      required: [reasoning]

  - name: request_user_input
    description: >-
      Pause the current task and request specific information from the user.
      Use this for login forms, passwords, captcha, or any scenario requiring
      user interaction before the task can proceed.
    parameters:
      type: object
      properties:
        fields:
          type: array
          items:
            type: object
            properties:
              name: { type: string }
              label: { type: string }
              type: { type: string, enum: [text, password, number, select] }
              required: { type: boolean }
            required: [name, label]
          description: List of fields to request from the user
        title:
          type: string
          description: Title for the input dialog
        prompt:
          type: string
          description: Prompt text explaining why this input is needed
      required: [fields]

  - name: finalize
    description: >-
      Mark the current task as complete and summarize what was accomplished.
      Use this after all subtasks are done.
    parameters:
      type: object
      properties:
        summary:
          type: string
          description: Summary of what was accomplished
        status:
          type: string
          enum: [success, partial, failed]
          description: Task outcome (default: success)
      required: [summary]

  - name: store_experience
    description: >-
      Store a reusable experience for future tasks. Use this after completing
      a complex or novel task to save the approach as an agent heuristic or
      task workflow that can be recalled later.
    parameters:
      type: object
      properties:
        type:
          type: string
          enum: [agent_heuristic, task_workflow, task_experience]
          description: Experience type
        content:
          type: string
          description: The experience content (steps, approach, lessons learned)
        source_task:
          type: string
          description: The task that generated this experience
        success:
          type: boolean
          description: Whether the source task was successful (default true)
      required: [type, content]

x-i18n:
  name_cn: 对话工具
  description_cn: 对话辅助工具：记忆管理、历史搜索、长期记忆回忆，以及智能体控制（think、request_user_input、finalize）。
  category_cn: 系统
  tools:
    agent_memory_update:
      name_cn: 更新记忆
      description_cn: 更新 Agent 长期记忆，用于记住用户偏好、个人信息和重要上下文。
    search_chat_history:
      name_cn: 搜索历史聊天记录
      description_cn: 搜索所有会话的历史聊天消息，查找过去讨论的内容。
    delete_chat_messages:
      name_cn: 删除聊天记录
      description_cn: 删除指定的聊天消息或清空整个会话。操作不可逆。
    recall_memory:
      name_cn: 回忆长期记忆
      description_cn: 搜索长期记忆中的用户画像、任务历史、行为准则等。
    think:
      name_cn: 内部思考
      description_cn: 在执行操作前记录推理过程，用于规划多步任务或评估方案。
    request_user_input:
      name_cn: 请求用户输入
      description_cn: 暂停任务并向用户请求特定信息（登录、密码、验证码等）。
    finalize:
      name_cn: 完成任务
      description_cn: 标记当前任务完成并总结成果。
    store_experience:
      name_cn: 存储经验
      description_cn: 将复杂/创新任务的执行方案存储为可复用的经验。
---
