---
name: system-config
description: >-
  System configuration tools for the AI agent: manage skills, models, settings,
  and scheduled tasks. This skill should be used when the agent needs to list
  or toggle skills, manage model providers, read or update application settings,
  or view scheduled background tasks.
license: MIT
compatibility: Requires Tauri v2+
usage: |-
  ## Quick Start

  - **List skills**: list_skills — all registered skills with status
  - **Toggle skill**: toggle_skill({skill_id, enabled}) — enable/disable a skill
  - **List models**: list_models — all configured providers
  - **Switch model**: switch_model({provider_id}) — change default provider
  - **Add model**: add_model({name, type, baseUrl, model, apiKey}) — register new provider
  - **Update model**: update_model({id, ...}) — modify existing provider
  - **Settings**: get_settings / update_settings({themeMode?, locale?, ...})
  - **Tasks**: list_scheduled_tasks — view all background tasks

tools:
  - name: list_skills
    description: List all registered skills (builtin and user-defined) with their status
    parameters:
      type: object
      properties: {}
      required: []
  - name: toggle_skill
    description: Enable or disable a skill by its ID
    parameters:
      type: object
      properties:
        skill_id:
          type: string
          description: The skill ID (e.g. "desktop_screen", "code_tools")
        enabled:
          type: boolean
          description: true to enable, false to disable
      required: [skill_id, enabled]
  - name: list_models
    description: List all configured model providers with their settings
    parameters:
      type: object
      properties: {}
      required: []
  - name: switch_model
    description: Switch the default model provider
    parameters:
      type: object
      properties:
        provider_id:
          type: string
          description: The provider ID to set as default
      required: [provider_id]
  - name: add_model
    description: Add a new model provider. The API key will be encrypted and stored securely.
    parameters:
      type: object
      properties:
        name:
          type: string
          description: Display name (e.g. "My GPT-4o")
        type:
          type: string
          enum: [openai, anthropic, google]
          description: Provider type
        baseUrl:
          type: string
          description: API endpoint URL (e.g. "https://api.openai.com/v1")
        model:
          type: string
          description: Model identifier (e.g. "gpt-4o")
        apiKey:
          type: string
          description: API key for authentication
        isDefault:
          type: boolean
          description: Set as default provider (default false)
        supportsTools:
          type: boolean
          description: Supports tool/function calling (default true)
        thinkingMode:
          type: boolean
          description: Enable thinking/reasoning mode (default false)
        supportsMultimodal:
          type: boolean
          description: Supports image+text input (default true)
      required: [name, type, baseUrl, model, apiKey]
  - name: update_model
    description: Update an existing model provider. Only provided fields will be changed.
    parameters:
      type: object
      properties:
        id:
          type: string
          description: The provider ID to update
        name:
          type: string
          description: New display name
        type:
          type: string
          enum: [openai, anthropic, google]
          description: Provider type
        baseUrl:
          type: string
          description: New API endpoint URL
        model:
          type: string
          description: New model identifier
        apiKey:
          type: string
          description: New API key (leave empty to keep existing)
        isDefault:
          type: boolean
          description: Set as default provider
        supportsTools:
          type: boolean
          description: Supports tool/function calling
        thinkingMode:
          type: boolean
          description: Enable thinking/reasoning mode
        supportsMultimodal:
          type: boolean
          description: Supports image+text input
      required: [id]
  - name: get_settings
    description: Read current application settings
    parameters:
      type: object
      properties: {}
      required: []
  - name: update_settings
    description: Update application settings. Only provided fields will be changed.
    parameters:
      type: object
      properties:
        themeMode:
          type: string
          enum: [system, light, dark]
          description: Theme mode
        locale:
          type: string
          enum: [en, zh]
          description: UI language
        enableGlobalListener:
          type: boolean
          description: Enable global input listener
  - name: list_scheduled_tasks
    description: List all scheduled background tasks (timers, screen watchers, etc.)
    parameters:
      type: object
      properties: {}
      required: []

x-i18n:
  name_cn: 系统配置
  description_cn: 系统配置工具：管理技能、模型、设置和后台任务。
  category_cn: 系统
  tools:
    list_skills:
      name_cn: 列出技能
      description_cn: 列出所有已注册的技能（内置和用户自定义）及其状态
    toggle_skill:
      name_cn: 切换技能
      description_cn: 按 ID 启用或禁用技能
    list_models:
      name_cn: 列出模型
      description_cn: 列出所有已配置的模型提供商及其设置
    switch_model:
      name_cn: 切换模型
      description_cn: 切换默认模型提供商
    add_model:
      name_cn: 添加模型
      description_cn: 添加新的模型提供商，API key 会加密存储
    update_model:
      name_cn: 更新模型
      description_cn: 更新现有模型提供商，只修改提供的字段
    get_settings:
      name_cn: 获取设置
      description_cn: 读取当前应用设置
    update_settings:
      name_cn: 更新设置
      description_cn: 更新应用设置，只修改提供的字段
    list_scheduled_tasks:
      name_cn: 列出后台任务
      description_cn: 列出所有后台任务（定时任务、屏幕监控等）
---
