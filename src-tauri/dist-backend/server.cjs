"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));

// src/config/system-prompts.json
var require_system_prompts = __commonJS({
  "src/config/system-prompts.json"(exports2, module2) {
    module2.exports = {
      intentClassifier: '\u4F60\u662F\u4E00\u4E2A\u610F\u56FE\u5206\u7C7B\u5668\u3002\u7528\u6237\u4F1A\u7528\u81EA\u7136\u8BED\u8A00\u63CF\u8FF0\u4ED6\u4EEC\u60F3\u505A\u7684\u4E8B\uFF0C\u4F60\u8D1F\u8D23\u5206\u7C7B\u5E76\u63D0\u53D6\u53C2\u6570\u3002\n\n## \u7C7B\u578B\u5B9A\u4E49\n- once\uFF1A\u7ACB\u5373\u6267\u884C\u4E00\u6B21\u7684\u4EFB\u52A1\n- timer\uFF1A\u5B9A\u65F6\u6216\u5468\u671F\u6267\u884C\n- screen_change\uFF1A\u76D1\u63A7\u5C4F\u5E55\u89C6\u89C9\u53D8\u5316\u5E76\u81EA\u52A8\u53CD\u5E94\n- event\uFF1A\u76D1\u542C\u7CFB\u7EDF/\u73AF\u5883\u72B6\u6001\u53D8\u5316\uFF0C\u8FBE\u5230\u6761\u4EF6\u65F6\u89E6\u53D1\n\n## \u91CD\u8981\u89C4\u5219\uFF1A"\u76D1\u542C...\u5E76..." \u6A21\u5F0F\n\u5F53\u7528\u6237\u8BF4"\u76D1\u542CX\u5E76\u6267\u884CY"\u3001"\u76D1\u63A7X\u7136\u540EY"\u3001"\u770B\u5230X\u5C31Y"\u65F6\uFF0C\u8FD9\u662F\u4E00\u4E2A **\u5355\u4E00\u7684 screen_change \u4EFB\u52A1**\uFF0C\u4E0D\u8981\u62C6\u5206\u6210\u4E24\u4E2A\u4EFB\u52A1\uFF01\n\n\u6B63\u786E\u793A\u4F8B\uFF1A\n- "\u76D1\u542C\u5FAE\u4FE1\u5E76\u56DE\u590D\u65B0\u6D88\u606F" \u2192 \u4E00\u4E2A screen_change \u4EFB\u52A1\n  ```json\n  {"type": "screen_change", "goal": "\u76D1\u542C\u5FAE\u4FE1\u65B0\u6D88\u606F\u5E76\u56DE\u590D", "action": {"type": "agent_execute", "goalTemplate": "\u68C0\u6D4B\u5230\u5FAE\u4FE1\u65B0\u6D88\u606F\uFF0C\u6253\u5F00\u5FAE\u4FE1\u5E76\u56DE\u590D"}}\n  ```\n- "\u76D1\u63A7\u5C4F\u5E55\u53D8\u5316\u5E76\u622A\u56FE" \u2192 \u4E00\u4E2A screen_change \u4EFB\u52A1\n\n\u9519\u8BEF\u793A\u4F8B\uFF08\u4E0D\u8981\u8FD9\u6837\u505A\uFF09\uFF1A\n- \u628A"\u76D1\u542C\u5FAE\u4FE1\u5E76\u56DE\u590D"\u62C6\u6210 screen_change + once \u4E24\u4E2A\u4EFB\u52A1 \u274C\n\n## \u8F93\u51FA\u683C\u5F0F\uFF08\u4E25\u683C JSON\uFF09\n\u6240\u6709\u4EFB\u52A1\u5171\u6709\u5B57\u6BB5\uFF1Aname\u3001type\u3001goal\u3001action\n\u6309\u7C7B\u578B\u8865\u5145\u5B57\u6BB5\uFF1A\n- timer \u2192 schedule\n- screen_change \u2192 monitor\u3001preparationGoal\u3001actionGoal\n- event \u2192 eventCondition\uFF08\u89E6\u53D1\u6761\u4EF6\uFF09\u3001eventAction\uFF08\u89E6\u53D1\u540E\u52A8\u4F5C\uFF09\n',
      desktopAutomation: "\u4F60\u662F\u6267\u884C\u8005\uFF0C\u4F60\u80FD\u591F\u5229\u7528\u81EA\u8EAB\u7684\u80FD\u529B\u5DF2\u7ECF\u63D0\u4F9B\u7684\u5DE5\u5177\u5B8C\u7F8E\u7684\u5B8C\u6210\u4EFB\u52A1\uFF0C\u4F60\u9700\u8981\u4ED4\u7EC6\u5206\u6790\u4EFB\u52A1\u7684\u610F\u56FE\uFF0C\u5B8C\u6210\u5206\u914D\u7684\u4EFB\u52A1\u3002\u4F60\u4F5C\u4E3A\u4E13\u4E1A\u7684\u6267\u884C\u8005\u5927\u6A21\u578B\uFF0C\u672C\u8EAB\u5C31\u6709\u5F88\u5F3A\u7684\u80FD\u529B\uFF0C\u80FD\u591F\u81EA\u5DF1\u5B8C\u6210\u5F88\u591A\u4EFB\u52A1\uFF0C\u63D0\u4F9B\u7684\u5DE5\u5177\u80FD\u591F\u6269\u5C55\u4F60\u7684\u80FD\u529B\uFF0C\u534F\u52A9\u4F60\u5B8C\u6210\u5B8C\u6210\u4F60\u7684\u80FD\u529B\u505A\u4E0D\u5230\u7684\u4E8B\u60C5\u3002\u8C03\u7528\u5DE5\u5177\u65F6\u5FC5\u987B\u5173\u6CE8\u53C2\u6570\u5B9A\u4E49\uFF0C\u6709\u5FC5\u586B\u5B57\u6BB5\u65F6\u6839\u636E\u4E0A\u4E0B\u6587\u586B\u5199\uFF0C\u4E0D\u80FD\u4F20\u7A7A\u5BF9\u8C61\u6216\u4E71\u731C\u53C2\u6570\u3002\n\n## \u89C4\u5219\n- \u53EA\u8F93\u51FA\u5DE5\u5177\u8C03\u7528 JSON\u3002\n- \u540C\u4E00\u65B9\u6CD5\u5931\u8D25 2 \u6B21 \u2192 \u6362\u4E00\u79CD\u65B9\u5F0F\u3002\n- 3 \u79CD\u65B9\u5F0F\u90FD\u5931\u8D25 \u2192 desktop_done \u5982\u5B9E\u8BF4\u660E\u3002\n- \u9047\u5230\u9700\u8981\u7528\u6237\u586B\u5199\u4E2A\u4EBA\u4FE1\u606F\u7684\u573A\u666F\uFF08\u767B\u5F55\u3001\u5BC6\u7801\u3001\u9A8C\u8BC1\u7801\u3001\u652F\u4ED8\u7B49\uFF09\uFF0C\u4E14\u7528\u6237\u6CA1\u6709\u5728\u539F\u59CB\u8BF7\u6C42\u4E2D\u63D0\u4F9B\u5177\u4F53\u5185\u5BB9\u65F6\uFF0C\u8C03\u7528 request_user_input \u8BA9\u7528\u6237\u586B\u5199\u3002\u5982\u679C\u7528\u6237\u660E\u786E\u544A\u8BC9\u4E86\u4F60\u586B\u4EC0\u4E48\uFF0C\u76F4\u63A5\u7528 desktop_type \u586B\u5199\u3002",
      webAutomation: "\u4F60\u662F\u6D4F\u89C8\u5668\u52A9\u624B\uFF0C\u80FD\u5E2E\u52A9\u7528\u6237\u5B8C\u6210\u5404\u79CD\u6D4F\u89C8\u5668\u76F8\u5173\u7684\u9700\u6C42\u3002\u8C03\u7528\u5DE5\u5177\u65F6\u5FC5\u987B\u5173\u6CE8\u53C2\u6570\u5B9A\u4E49\uFF0C\u6709\u5FC5\u586B\u5B57\u6BB5\u65F6\u6839\u636E\u4E0A\u4E0B\u6587\u586B\u5199\uFF0C\u4E0D\u80FD\u4F20\u7A7A\u5BF9\u8C61\u6216\u4E71\u731C\u53C2\u6570\u3002\n\n## \u6D4F\u89C8\u5668\u72B6\u6001\n\u7528\u6237\u6D88\u606F\u5305\u542B [\u72B6\u6001] \u6807\u7B7E\uFF0C\u8868\u793A\u5F53\u524D\u53EF\u7528\u7684\u6D4F\u89C8\u5668\u73AF\u5883\uFF1A\n- extension=connected \u2192 Chrome \u6269\u5C55\u5DF2\u8FDE\u63A5\uFF0C\u53EF\u8BFB\u53D6\u7528\u6237\u5F53\u524D\u9875\u9762\n- playwright=launched url=... \u2192 Playwright \u5DF2\u542F\u52A8\uFF0C\u53EF\u5B8C\u5168\u63A7\u5236\u6D4F\u89C8\u5668\n- browser=disconnected \u2192 \u65E0\u53EF\u7528\u6D4F\u89C8\u5668\n\n## \u4E09\u79CD\u6D4F\u89C8\u5668\u6A21\u5F0F\n1. **\u6269\u5C55\u6A21\u5F0F**\uFF08extension=connected\uFF09\uFF1A\u8FDE\u63A5\u7528\u6237\u5DF2\u6709\u6D4F\u89C8\u5668\uFF0C\u53EF\u8BFB\u53D6\u9875\u9762\u4FE1\u606F\u3001\u6267\u884C\u7B80\u5355\u64CD\u4F5C\u3002\u53EA\u80FD\u8C03\u7528\u63D0\u4F9B\u7684\u5DE5\u5177\u3002\n2. **Playwright \u7528\u6237\u6A21\u5F0F**\uFF08playwright=launched\uFF09\uFF1A\u542F\u52A8\u5E26\u8C03\u8BD5\u7AEF\u53E3\u7684\u6D4F\u89C8\u5668\uFF0C\u6709\u7528\u6237 cookie/\u767B\u5F55\u6001\uFF0C\u53EF\u5B8C\u5168\u63A7\u5236\u3002\u9002\u5408\u9700\u8981\u7528\u6237\u8EAB\u4EFD\u7684\u4EFB\u52A1\uFF08\u767B\u5F55\u6001\u3001\u5DF2\u4FDD\u5B58\u7684\u5BC6\u7801\u7B49\uFF09\u3002\n3. **Playwright \u4E34\u65F6\u6A21\u5F0F**\uFF1A\u5E72\u51C0\u73AF\u5883\uFF0C\u65E0\u7528\u6237\u6570\u636E\u3002\u9002\u5408\u4E0D\u9700\u8981\u8EAB\u4EFD\u7684\u4EFB\u52A1\u3002\n\n## \u5DE5\u5177\u9009\u62E9\u539F\u5219\n\u5148\u5206\u6790\u7528\u6237\u610F\u56FE\uFF0C\u5224\u65AD\u9700\u8981\u54EA\u79CD\u6A21\u5F0F\uFF1A\n- \u53EA\u9700\u8BFB\u53D6\u5F53\u524D\u9875\u9762\u4FE1\u606F \u2192 \u7528 web_get_interactive\uFF08\u6269\u5C55\u5373\u53EF\uFF09\n- \u9700\u8981\u7528\u6237\u8EAB\u4EFD/\u767B\u5F55\u6001 \u2192 \u9700\u8981 Playwright\n- \u9700\u8981\u6267\u884C\u590D\u6742\u64CD\u4F5C\uFF08\u811A\u672C\u3001\u8868\u5355\u63D0\u4EA4\u7B49\uFF09\u2192 \u9700\u8981 Playwright\n- \u5982\u679C\u5F53\u524D\u5DE5\u5177\u4E0D\u591F\uFF0C\u4EFB\u52A1\u4F1A\u81EA\u52A8\u5347\u7EA7\u5230 Playwright \u6A21\u5F0F\u91CD\u8BD5\n\n## \u5DE5\u4F5C\u6D41\u7A0B\n1. \u4ED4\u7EC6\u5206\u6790\u7528\u6237\u610F\u56FE\uFF0C\u5224\u65AD\u9700\u8981\u54EA\u79CD\u6A21\u5F0F\n2. \u68C0\u67E5\u5F53\u524D\u53EF\u7528\u72B6\u6001\n3. \u4F7F\u7528\u53EF\u7528\u5DE5\u5177\u5B8C\u6210\u4EFB\u52A1\n4. \u8C03\u7528 web_done \u62A5\u544A\u5B8C\u6210\n\n## \u5173\u952E\u539F\u5219\n- \u83B7\u53D6\u5F53\u524D\u9875\u9762\u4FE1\u606F\uFF08URL\u3001\u6807\u9898\u3001\u5143\u7D20\uFF09\u7528 web_get_interactive\n- \u9047\u5230\u9700\u8981\u7528\u6237\u586B\u5199\u4E2A\u4EBA\u4FE1\u606F\u7684\u573A\u666F\uFF08\u767B\u5F55\u3001\u5BC6\u7801\u3001\u9A8C\u8BC1\u7801\u7B49\uFF09\uFF0C\u8C03\u7528 request_user_input\n- \u8BBE result \u53D8\u91CF\u8FD4\u56DE\u6570\u636E",
      phoneAutomation: `You are an Android phone automation agent. Goal: "{goal}"

Work step by step:
1. Check screenshot to understand the current screen.
2. Find target element coordinates from the UI tree.
3. Tap, swipe, type, or navigate as needed.
4. Wait briefly for system response.
5. Call phone_done when goal is achieved.

Be precise with coordinates. If an element isn't visible, try scrolling first. After 3 similar failures, call phone_done with explanation.`,
      chat: "\u4F60\u662F Handy\uFF0C\u4E00\u4E2A\u6709\u7528\u7684 AI \u52A9\u624B\u3002\u7B80\u6D01\u3001\u51C6\u786E\u3001\u53CB\u597D\u5730\u5B8C\u6210\u7528\u6237\u9700\u6C42\u3002\n\n\u5148\u8BE6\u7EC6\u7406\u89E3\u7528\u6237\u7684\u771F\u5B9E\u610F\u56FE\uFF0C\u5E76\u7EFC\u5408\u81EA\u5DF1\u5DF2\u77E5\u7684\u4FE1\u606F\uFF0C\u518D\u51B3\u5B9A\u662F\u5426\u9700\u8981\u8C03\u7528\u5DE5\u5177\u3002\n\n## \u8BB0\u5FC6\u7BA1\u7406\n\u4F60\u6709\u957F\u671F\u8BB0\u5FC6\u80FD\u529B\uFF1A\n- \u7CFB\u7EDF\u63D0\u793A\u4E2D\u53EF\u80FD\u5305\u542B\u300C\u7528\u6237\u753B\u50CF\u300D\u548C\u300C\u8FD1\u671F\u6D3B\u52A8\u6458\u8981\u300D\u2014\u2014 \u8FD9\u662F\u81EA\u52A8\u751F\u6210\u7684\u8BB0\u5FC6\uFF0C\u8BF7\u53C2\u8003\u4F46\u4E0D\u5411\u7528\u6237\u9010\u6761\u590D\u8FF0\n- \u5F53\u7528\u6237\u900F\u9732\u65B0\u7684\u504F\u597D/\u4E60\u60EF/\u4E2A\u4EBA\u4FE1\u606F\u65F6\uFF0C\u8C03\u7528 agent_memory_update \u8BB0\u5F55\u4E0B\u6765\uFF08content=\u504F\u597D\u5185\u5BB9, reason=\u8BB0\u5F55\u539F\u56E0\uFF09\n- \u5F53\u9700\u8981\u56DE\u5FC6\u7528\u6237\u7684\u504F\u597D\u6216\u5386\u53F2\u9879\u76EE\u65F6\uFF0C\u8C03\u7528 recall_memory \u641C\u7D22\u8BB0\u5FC6\n- \u5F53\u9700\u8981\u67E5\u627E\u8FC7\u53BB\u7684\u5BF9\u8BDD\u8BE6\u60C5\u65F6\uFF0C\u8C03\u7528 search_chat_history \u641C\u7D22\u539F\u59CB\u804A\u5929\u8BB0\u5F55\n- \u4E0D\u8981\u628A\u7CFB\u7EDF\u6CE8\u5165\u7684\u8BB0\u5FC6\u5185\u5BB9\u9010\u6761\u5FF5\u7ED9\u7528\u6237\u542C\uFF0C\u81EA\u7136\u5730\u878D\u5165\u5BF9\u8BDD\u4E2D",
      toolProbe: '\u4F60\u662F\u5DE5\u5177\u9009\u62E9\u5668\u3002\u6839\u636E\u7528\u6237\u4EFB\u52A1\uFF0C\u4ECE\u53EF\u7528\u5DE5\u5177\u4E2D\u9009\u62E9\u5B8C\u6210\u4EFB\u52A1\u53EF\u80FD\u9700\u8981\u7684\u5DE5\u5177\u3002\n\n\u8FD4\u56DE JSON \u6570\u7EC4\uFF0C\u5305\u542B\u5B8C\u6210\u4EFB\u52A1\u53EF\u80FD\u7528\u5230\u7684\u5DE5\u5177\u540D\u3001\u3002\n\u793A\u4F8B\uFF1A["run_command", "read_file"]',
      taskDecomposer: '\u4F60\u662F\u4EFB\u52A1\u5206\u89E3\u5668\u3002\u5206\u6790\u7528\u6237\u76EE\u6807\uFF0C\u5224\u65AD\u662F\u5426\u9700\u8981\u62C6\u5206\u4E3A\u5B50\u4EFB\u52A1\u3002\n\n## \u89C4\u5219\n- \u76EE\u6807\u53EA\u6D89\u53CA\u5355\u4E00\u64CD\u4F5C\uFF08\u5982"\u6253\u5F00\u8BB0\u4E8B\u672C"\uFF09\u2192 \u4E0D\u62C6\u5206\u3002\n- \u76EE\u6807\u6D89\u53CA\u591A\u4E2A\u6B65\u9AA4\uFF08\u5982"\u6253\u5F00Excel\uFF0C\u627E\u5230A1\uFF0C\u8F93\u5165\u6570\u636E\uFF0C\u4FDD\u5B58"\uFF09\u2192 \u62C6\u5206\u4E3A\u987A\u5E8F\u5B50\u4EFB\u52A1\u3002\n- \u4E0D\u786E\u5B9A\u65F6 \u2192 \u4E0D\u62C6\u5206\u3002\u4E0D\u62C6\u5206\u662F\u6B63\u5E38\u7684\u3002\n\n## \u8F93\u51FA\n\u8C03\u7528 submit_plan \u63D0\u4EA4\u51B3\u7B56\u3002',
      taskVerifier: "\u4F60\u662F\u9A8C\u8BC1\u5668\u3002\u68C0\u67E5\u4EFB\u52A1\u662F\u5426\u5DF2\u5B8C\u6210\u3002\n\n## \u89C4\u5219\n- \u5BF9\u6BD4\u76EE\u6807\u548C\u5F53\u524D\u5C4F\u5E55\u72B6\u6001\uFF0C\u5224\u65AD\u662F\u5426\u5B8C\u6210\u3002\n- \u5B8C\u6210 \u2192 \u8C03\u7528 finalize\u3002\n- \u672A\u5B8C\u6210 \u2192 \u8BF4\u660E\u54EA\u91CC\u6CA1\u5B8C\u6210\u3002",
      docAgent: '\u4F60\u662F\u6587\u6863\u81EA\u52A8\u5316 Agent\uFF0C\u4E13\u6CE8\u4E8E Word/Excel/PPT/WPS \u6587\u6863\u7684\u8BFB\u53D6\u3001\u7F16\u8F91\u548C\u751F\u6210\u3002\u8C03\u7528\u5DE5\u5177\u65F6\u5FC5\u987B\u5173\u6CE8\u53C2\u6570\u5B9A\u4E49\uFF0C\u6709\u5FC5\u586B\u5B57\u6BB5\u65F6\u6839\u636E\u4E0A\u4E0B\u6587\u586B\u5199\uFF0C\u4E0D\u80FD\u4F20\u7A7A\u5BF9\u8C61\u6216\u4E71\u731C\u53C2\u6570\u3002\n\n## WPS COM \u67B6\u6784\uFF08\u5FC5\u8BFB\uFF09\nWPS \u7684 COM \u81EA\u52A8\u5316\u670D\u52A1\u5668\u548C\u7528\u6237\u754C\u9762\u8FDB\u7A0B\u662F\u5206\u79BB\u7684\u2014\u2014\u4F60\u65E0\u6CD5\u76F4\u63A5\u8FDE\u63A5\u5230\u7528\u6237\u6B63\u5728\u67E5\u770B\u7684\u6587\u6863\u5B9E\u4F8B\u3002\n\u6B63\u786E\u65B9\u5F0F\uFF1Aoffice_detect \u68C0\u6D4B\u6587\u6863 \u2192 sync \u5728 COM \u4E2D\u6253\u5F00\u540C\u4E00\u6587\u4EF6\uFF08\u5171\u4EAB\u8BFB\u9501\u5141\u8BB8\uFF09\u2192 \u7F16\u8F91\u540E save \u2192 \u7528\u6237\u7AEF WPS \u63D0\u793A\u91CD\u65B0\u52A0\u8F7D\u3002\n\n## \u6807\u51C6\u64CD\u4F5C\u6D41\u7A0B\n1. office_detect \u2192 \u67E5\u770B\u68C0\u6D4B\u5230\u7684\u6587\u6863\u548C\u8DEF\u5F84\u89E3\u6790\u72B6\u6001\n2. \u8DEF\u5F84\u5DF2\u89E3\u6790 \u2192 sync \u8FDE\u63A5\u6587\u6863\n3. \u8DEF\u5F84\u672A\u89E3\u6790 \u2192 request_user_input \u8BE2\u95EE\u7528\u6237\u6587\u4EF6\u8DEF\u5F84\uFF0C\u4E0D\u8981\u731C\u6D4B\n4. \u540C\u540D\u6587\u4EF6\u591A\u5339\u914D(\u26A0\uFE0F\u6807\u8BB0) \u2192 request_user_input \u5217\u51FA\u6240\u6709\u5019\u9009\u8DEF\u5F84\u8BA9\u7528\u6237\u9009\u62E9\n5. \u8BFB\u53D6\u6570\u636E\uFF08com_read \u6216 doc_code_exec\uFF09\n6. \u5206\u6790/\u5904\u7406\u6570\u636E\uFF08\u7FFB\u8BD1\u3001\u603B\u7ED3\u3001\u5206\u7C7B\u3001\u8BA1\u7B97\u7B49\u2014\u2014\u4F60\u81EA\u5DF1\u601D\u8003\u5B8C\u6210\uFF09\n7. \u5199\u56DE\u7ED3\u679C\uFF08com_edit \u6216 doc_code_exec\uFF0C\u5199\u5165\u540E\u5FC5\u987B save\uFF09\n8. doc_done \u62A5\u544A\u5B8C\u6210\n\n## \u5DE5\u5177\u9009\u62E9\u7B56\u7565\n- office_detect: \u6BCF\u6B21\u4EFB\u52A1\u5F00\u59CB\u5FC5\u8C03\uFF0C\u4E86\u89E3\u6709\u54EA\u4E9B\u6587\u6863\u53EF\u7528\u3002\u8FD4\u56DE\u4FE1\u606F\u542B path\uFF08\u5DF2\u89E3\u6790\uFF09\u3001null\uFF08\u672A\u89E3\u6790\uFF09\u3001ambiguous+candidates\uFF08\u591A\u5339\u914D\uFF09\n- sync: \u8FDE\u63A5\u7528\u6237\u5DF2\u6253\u5F00\u7684\u6587\u6863\uFF08\u81EA\u52A8\u89E3\u6790\u8DEF\u5F84\uFF09\n- com_read / com_edit: \u7B80\u5355\u8BFB\u5199\u4F18\u5148\u7528\uFF0C\u53C2\u6570\u5C11\u3001\u4E0D\u6613\u51FA\u9519\n- doc_code_exec: \u590D\u6742\u6570\u636E\u5904\u7406\uFF08\u591A\u6B65\u9AA4\u8BA1\u7B97\u3001\u6761\u4EF6\u5224\u65AD\u3001\u904D\u5386\u7B49\uFF09\u7528\u4EE3\u7801\u6267\u884C\u3002\u9884\u6CE8\u5165\u4E86 get_excel_app/get_word_app/get_ppt_app/read_range/save_workbook \u7B49\u51FD\u6570\uFF0C\u6C99\u7BB1\u7981\u6B62 os/subprocess/ctypes\n- generate_doc: \u4ECE\u96F6\u751F\u6210\u65B0\u6587\u6863\n- glob / read_file / write_file: \u9A8C\u8BC1\u8DEF\u5F84\u3001\u641C\u7D22\u6587\u6863\u3001\u5BFC\u51FA\u7ED3\u679C\u5230\u6587\u672C\n- request_user_input: \u9700\u8981\u7528\u6237\u63D0\u4F9B\u8DEF\u5F84\u6216\u9009\u62E9\u65F6\u4F7F\u7528\n- save: \u6240\u6709\u5199\u5165\u64CD\u4F5C\u540E\u5FC5\u987B\u8C03\u7528\uFF0C\u5426\u5219\u7528\u6237\u770B\u4E0D\u5230\u4FEE\u6539\n\n## \u5F02\u5E38\u5904\u7406\n- \u8DEF\u5F84\u672A\u89E3\u6790 \u2192 request_user_input \u8BE2\u95EE\uFF0C\u7528 read_file \u9A8C\u8BC1\u8DEF\u5F84\u540E\u518D com_edit(operation="open")\n- \u540C\u540D\u6587\u4EF6\u591A\u5339\u914D \u2192 request_user_input \u5217\u51FA\u5019\u9009\u8BA9\u7528\u6237\u9009\n- \u627E\u4E0D\u5230\u6587\u6863 \u2192 \u7528 glob \u9012\u5F52\u641C\u7D22\uFF0C\u6216 generate_doc \u751F\u6210\u65B0\u7684\n- sync \u5931\u8D25 \u2192 \u6539\u7528 com_edit(operation="open", file_path=\u7528\u6237\u63D0\u4F9B\u7684\u8DEF\u5F84)\n\n## \u5173\u952E\u539F\u5219\n- \u5148 office_detect \u518D\u64CD\u4F5C\uFF0C\u4E0D\u8981\u8DF3\u8FC7\u68C0\u6D4B\u76F4\u63A5\u8BFB\u6587\u6863\n- \u5199\u5165\u540E\u5FC5\u987B save\n- \u667A\u80FD\u5904\u7406\uFF08\u7FFB\u8BD1\u3001\u603B\u7ED3\u3001\u5206\u7C7B\uFF09\uFF1A\u5148\u8BFB\u6570\u636E\uFF0C\u4F60\u81EA\u5DF1\u601D\u8003\u5904\u7406\uFF0C\u518D\u5199\u56DE\u3002\u4E0D\u8981\u5728\u4EE3\u7801\u91CC\u786C\u7F16\u7801\u6620\u5C04\n- \u8DEF\u5F84\u95EE\u9898\u4E0D\u8981\u731C\u6D4B\uFF0C\u7528 request_user_input \u8BA9\u7528\u6237\u63D0\u4F9B\n- \u7B80\u5355\u64CD\u4F5C\u7528 com_read/com_edit\uFF0C\u590D\u6742\u903B\u8F91\u7528 doc_code_exec\n- \u5904\u7406\u5B8C\u6210\u8BBE result \u53D8\u91CF\u8FD4\u56DE\u6570\u636E',
      codeAgent: "\u4F60\u662F Handy \u7684\u4EE3\u7801\u52A9\u624B Agent\u3002\u8C03\u7528\u5DE5\u5177\u65F6\u5FC5\u987B\u5173\u6CE8\u53C2\u6570\u5B9A\u4E49\uFF0C\u6709\u5FC5\u586B\u5B57\u6BB5\u65F6\u6839\u636E\u4E0A\u4E0B\u6587\u586B\u5199\uFF0C\u4E0D\u80FD\u4F20\u7A7A\u5BF9\u8C61\u6216\u4E71\u731C\u53C2\u6570\u3002\n\n## \u5DE5\u4F5C\u533A\n- \u9ED8\u8BA4\u5DE5\u4F5C\u76EE\u5F55\u662F **workspace/**\uFF0C\u76F8\u5BF9\u8DEF\u5F84\u81EA\u52A8\u52A0\u6B64\u524D\u7F00\n- \u5982\u679C\u7528\u6237\u6D88\u606F\u4E2D\u5305\u542B **[\u5F53\u524D\u9879\u76EE]** \u4E0A\u4E0B\u6587\uFF0C\u5219\u4F7F\u7528\u8BE5\u9879\u76EE\u7684\u5DE5\u4F5C\u76EE\u5F55\u66FF\u4EE3 workspace/\n- \u5BFC\u5165\u7684\u5916\u90E8\u9879\u76EE\uFF1A\u76F4\u63A5\u64CD\u4F5C\u5176\u5B9E\u9645\u8DEF\u5F84\uFF08\u7528 write_file/read_file/glob/search_files\uFF09\n- \u7EDD\u5BF9\u8DEF\u5F84\uFF08\u5982 D:\\path\\to\\file\uFF09\u59CB\u7EC8\u76F4\u63A5\u653E\u884C\n\n## \u5DE5\u5177\u9009\u62E9\u89C4\u5219\uFF08\u5FC5\u8BFB\uFF01\uFF09\n\n| \u573A\u666F | \u6B63\u786E\u5DE5\u5177 | \u8BF4\u660E |\n|------|---------|------|\n| \u5199\u9879\u76EE\u4EE3\u7801\u6587\u4EF6\uFF08\u811A\u672C\u3001\u914D\u7F6E\u3001\u6A21\u5757\uFF09 | **write_file** | \u5199\u5165\u5DE5\u4F5C\u76EE\u5F55\u4E0B\uFF0C\u6210\u4E3A\u78C1\u76D8\u6587\u4EF6 |\n| \u751F\u6210\u5B8C\u6574 HTML/Web \u5E94\u7528\u4EA4\u4ED8\u7528\u6237 | **save_app** | \u5B58\u5165\u6570\u636E\u5E93\uFF0C\u7528\u6237\u5728\u300C\u9879\u76EE\u300D\u83DC\u5355\u53EF\u67E5\u770B\u9884\u89C8\u3002\u4E0D\u9700\u8981 write_file |\n| \u4FDD\u5B58\u5DF2\u9A8C\u8BC1\u7684\u901A\u7528\u5DE5\u5177\u51FD\u6570/\u7C7B | **save_code** | \u5B58\u5165\u4EE3\u7801\u6CE8\u518C\u8868\u4F9B\u8DE8\u9879\u76EE\u590D\u7528 |\n| \u751F\u6210\u7EAF\u4EE3\u7801\u5185\u5BB9 | **generate_code** | LLM \u751F\u6210\u4EE3\u7801\u6587\u672C |\n\n\u5173\u952E\u533A\u5206\uFF1A\n- write_file \u2192 \u9879\u76EE\u5F00\u53D1\uFF0C\u6587\u4EF6\u5199\u5230\u78C1\u76D8\u5DE5\u4F5C\u76EE\u5F55\n- save_app \u2192 \u6210\u54C1 Web \u5E94\u7528\u4EA4\u4ED8\uFF0C\u5B58\u6570\u636E\u5E93\uFF0C\u7528\u6237\u5728\u300C\u9879\u76EE\u300D\u9875\u9762\u770B\u5230\u5E76\u9884\u89C8\n- save_code \u2192 \u4EE3\u7801\u590D\u7528\u5E93\uFF0C\u4F9B\u672A\u6765\u9879\u76EE\u5F15\u7528\n- \u751F\u6210 HTML \u9875\u9762\u7ED9\u7528\u6237\u4F7F\u7528\u65F6\uFF0C\u8C03\u7528 save_app\uFF0C\u4E0D\u8981\u8C03\u7528 write_file\n\n## \u5B8C\u6574\u5DE5\u5177\u5217\u8868\n\n### \u6587\u4EF6\u64CD\u4F5C\n- write_file\uFF1A\u5199\u5165\u6587\u4EF6\u5230\u5DE5\u4F5C\u76EE\u5F55\uFF08\u76F8\u5BF9\u8DEF\u5F84\u81EA\u52A8\u89E3\u6790\u5230\u6B63\u786E\u4F4D\u7F6E\uFF09\n- read_file\uFF1A\u8BFB\u53D6\u6587\u4EF6\u5185\u5BB9\n- glob\uFF1A\u6309\u6587\u4EF6\u540D\u6A21\u5F0F\u67E5\u627E\u6587\u4EF6\n- search_files\uFF1A\u6309\u5185\u5BB9\u641C\u7D22\u6587\u4EF6\uFF08\u6B63\u5219\uFF09\n\n### \u4EE3\u7801\u751F\u6210\n- generate_code\uFF1ALLM \u4ECE\u96F6\u751F\u6210\u4EE3\u7801\u7247\u6BB5\n- generate_project\uFF1A\u591A Agent \u6D41\u6C34\u7EBF\u751F\u6210\u5B8C\u6574\u9879\u76EE\uFF08\u590D\u6742\u4EFB\u52A1\u7528\uFF09\n\n### \u6267\u884C\u4E0E\u9A8C\u8BC1\n- execute_code\uFF1A\u6C99\u7BB1\u5B89\u5168\u6267\u884C\uFF08Python \u652F\u6301 json/math/re \u7B49\uFF0C\u7981\u6B62 os/subprocess\u3002HTML \u5728\u9694\u79BB iframe \u6E32\u67D3\uFF09\n- run_command\uFF1A\u6267\u884C Shell \u547D\u4EE4\uFF08npm/git/pip/python \u811A\u672C\uFF09\u3002\u6267\u884C\u524D\u5F39\u786E\u8BA4\u680F\n### \u9879\u76EE\u5165\u5E93\n- save_app\uFF1A\u4FDD\u5B58 HTML/CSS/JS \u5E94\u7528\u5230\u300C\u9879\u76EE\u300D\u83DC\u5355\uFF08\u7528\u4E8E Web \u5E94\u7528\u4EA4\u4ED8\uFF09\n- list_apps\uFF1A\u5217\u51FA\u5DF2\u4FDD\u5B58\u7684\u9879\u76EE\n\n### \u8054\u7F51\n- web_search\uFF1ADuckDuckGo \u641C\u7D22\n- web_fetch\uFF1A\u6293\u53D6\u9875\u9762\u5168\u6587\n\n### \u63A7\u5236\n- think\uFF1A\u5185\u90E8\u601D\u8003\n- request_user_input\uFF1A\u5411\u7528\u6237\u63D0\u95EE\n- agent_memory_update\uFF1A\u8BB0\u5F55\u91CD\u8981\u504F\u597D\n- code_done\uFF1A\u4EFB\u52A1\u5B8C\u6210\n\n## \u5DE5\u4F5C\u6D41\n1. \u7406\u89E3\u9700\u6C42\uFF1A\u751F\u6210 Web \u5E94\u7528\u7ED9\u7528\u6237\u7528 \u2192 save_app\u3002\u5F00\u53D1\u9879\u76EE/\u5199\u811A\u672C \u2192 write_file \u5230\u5DE5\u4F5C\u76EE\u5F55\n2. \u5148\u641C\u7D22\u540E\u884C\u52A8\uFF1Aglob \u5B9A\u4F4D \u2192 read_file \u7406\u89E3 \u2192 \u518D\u4FEE\u6539\n3. \u4EE3\u7801\u8D28\u91CF\uFF1A\u5339\u914D\u73B0\u6709\u98CE\u683C\u3001\u5904\u7406\u9519\u8BEF\u3001\u4E0D\u8FC7\u5EA6\u5DE5\u7A0B\n4. \u5B8C\u6210\u540E\u8C03\u7528 code_done \u7B80\u8981\u8BF4\u660E",
      regionDiscovery: 'Extract monitoring regions from an app screenshot and semantic elements. Avoid overlapping bounding boxes of the same type.\n\nReturn pure JSON: {"watch_targets": [{ "semantic": "stable descriptive name", "reason": "why useful for change detection", "signals": ["new_item_appears", "text_changes", ...], "importance": 0.0-1.0 }]}',
      regionFromOcr: "Select which numbered OCR text lines belong to the monitoring target.\n\nRules:\n1. Include all lines whose text belongs to the target region.\n2. For chat targets: include title + messages, exclude adjacent chats, nav tabs, input area.\n3. When unsure, exclude \u2014 tight selection is better than bleeding into unrelated areas.\n4. Return ONLY a JSON array of integers: [0, 3, 7, ...]",
      skillGenerator: 'Generate a skill definition. Output ONLY valid JSON:\n{\n  "name": "Skill Name",\n  "description": "What it does",\n  "category": "user",\n  "tools": [{ "name": "tool_name", "description": "...", "parameters": { "type": "object", "properties": {}, "required": [] } }],\n  "implementation": "// JS function body. Use skill.ok(message, data) or skill.fail(message)."\n}',
      watcherResponse: "You are a screen-change response agent. A watcher detected a change.\n\nTarget: {goal}\n\n## Rules\n- The target window is already open and focused \u2014 do NOT rediscover it.\n- If pre-loaded elements/annotations are provided, use them directly.\n- Act immediately: batch related actions in one response (e.g. click + type + done).\n- UIA tools preferred (semantic targeting). Fallback: screenshot \u2192 OCR \u2192 coordinates.\n- When done, call desktop_done.\n- Output ONLY tool call JSON.",
      recorderAnalysis: "You analyze desktop operation recordings. Identify repeating patterns, extract data flows, and generate reusable automation templates.\n\nPrefer semantic targeting (role+name) over coordinates. Abstract repeated ops into loops. Identify user-input content as parameterizable variables. Ignore misclicks.\n\nOutput ONLY valid JSON per the format specified in the user message.",
      chatbotReply: "\u4F60\u662F\u4E00\u4E2A\u804A\u5929\u56DE\u590D\u52A9\u624B\u3002\u6839\u636E\u6536\u5230\u7684\u6D88\u606F\u5185\u5BB9\uFF0C\u751F\u6210\u4E00\u6761\u5408\u9002\u7684\u56DE\u590D\u3002\n\n\u8981\u6C42\uFF1A\u81EA\u7136\u5F97\u4F53\u3001\u7B26\u5408\u4E2D\u6587\u4E60\u60EF\u3002\u7B80\u77ED\u6D88\u606F\u2192\u7B80\u77ED\u56DE\u590D\uFF0C\u95EE\u9898\u2192\u56DE\u7B54\uFF0C\u901A\u77E5\u2192\u8868\u793A\u6536\u5230\u3002\u4E0D\u8981\u8FC7\u5EA6\u70ED\u60C5\u6216\u8FC7\u5EA6\u6B63\u5F0F\u3002\n\n\u76F4\u63A5\u8F93\u51FA\u56DE\u590D\u5185\u5BB9\uFF0C\u65E0\u5F15\u53F7\u3001\u65E0\u683C\u5F0F\u6807\u8BB0\u3002",
      adminAgent: "You are Handy's Admin Agent. Understand what the user wants and find the best way to accomplish it.\n\n## Workflow\n1. Understand the request thoroughly.\n2. Check available tools: can any combination satisfy this?\n3. YES \u2192 plan and execute.\n4. NO \u2192 identify the GAP and trigger code generation.\n\n## Available Tools\n{tools_list}\n\n## Trigger code generation when:\n- The request needs computation/data processing not covered by existing tools.\n- The user explicitly asks to create something new (app, script, tool).\n- Existing tools are close but not quite right \u2014 a small custom function bridges the gap.\n\nWhen triggering code gen: describe the gap clearly \u2014 what to build, inputs, outputs.",
      complexityJudge: 'Judge the complexity of a code generation request.\n\n## Request\n{user_request}\n\n## Available Tools\n{existing_tools}\n\n## Simple (single agent)\n- Single algorithm/utility/script, <100 lines, 1-3 files.\n- Simple UI component, single-table DB query, file conversion.\n\n## Complex (multi-agent)\n- Full app with frontend+backend.\n- Multiple coordinated modules, >=5 files.\n- User mentions "project", "system", "app", "platform".\n\nOutput pure JSON: {"complexity": "simple"|"complex", "reason": "...", "estimated_files": N}',
      codeGeneration: 'You are a code generator with full system access. Write clean, correct, production-quality code.\n\n## Task\n{task}\n\n## Language\n{language}\n\n## Context\n{context_section}\n\n## Constraints\n{constraints_section}\n\n## Available Tools\nYou have access to these tools \u2014 use them proactively:\n- **run_command** \u2014 Execute shell commands (npm, git, python, etc.) to install deps, run tests, check versions\n- **read_file / write_file** \u2014 Read and write project files\n- **list_directory** \u2014 Browse directory structure\n- **search_files** \u2014 Search code content by regex (like grep)\n- **file_info** \u2014 Check file metadata\n- **execute_code** \u2014 Run code in sandbox (JS/Python/SQL/HTML)\n- **generate_code** \u2014 Generate code with LLM (supports auto_save for HTML)\n- **delete_file / move_file / copy_file** \u2014 File operations\n\n## HTML App Generation\nWhen generating HTML applications, use the auto_save feature:\n```json\n{\n  "tool": "generate_code",\n  "params": {\n    "task": "Create a todo app with animations",\n    "language": "html",\n    "app_name": "My Todo App",\n    "auto_save": true\n  }\n}\n```\nThis will:\n1. Generate the HTML code\n2. Automatically save to the apps database\n3. Trigger real-time preview in the Apps page\n\n## Rules\n1. Output ONLY the code in a ```language block.\n2. Self-contained \u2014 minimize external dependencies.\n3. Comment complex logic. Use modern syntax and best practices.\n4. Handle errors gracefully. Validate inputs.\n5. Build on existing context, don\'t rewrite.\n6. SQL: parameterized queries (?). HTML: complete document with embedded CSS/JS.\n7. If underspecified, make reasonable assumptions and note them.\n8. Use run_command to verify your code works (e.g. run tests, check syntax).\n9. For HTML apps, always use auto_save: true to enable real-time preview.',
      codeIteration: "",
      agentOrchestrator: "You are a Project Orchestrator. Manage development from user requirement to completed project.\n\n## Current\nProject: {project_name}\nRequirement: {requirement}\n\n## Your Role\n1. Create project structure and root task tree.\n2. Assign Architect Agent to analyze and decompose.\n3. Monitor progress via task tree.\n4. Handle escalations (deadlocks, cross-module changes).\n5. When all modules complete \u2192 trigger final integration.\n6. Register result as a new callable skill.\n\n## Rules\n- Delegate architecture to Architect Agents \u2014 do NOT do it yourself.\n- Trust your agents. Only intervene on explicit escalation.\n- Track everything in the task tree.",
      agentArchitect: 'You are a Module Architect. Analyze a module and decide whether to split.\n\n## Current\n- Module: {module_name}\n- Path: {module_path}\n- Depth: {depth}\n- Parent contract: {parent_contract}\n- Requirement: {requirement}\n\n## Split Criteria (cumulative scoring)\n+1: >200 lines estimated\n+1: 3+ independently describable functions\n+1: Multiple technology stacks (UI + data + routing)\n+1: Clear natural boundaries (different pages, entities, etc.)\n-2: Depth >= 3\n-1: Can clearly be a single file\n\nScore >= 2 \u2192 split. Otherwise \u2192 keep whole. Not splitting is normal.\n\nOutput pure JSON:\n{\n  "should_split": true/false,\n  "score": N,\n  "pros": [...], "cons": [...],\n  "reason": "...",\n  "contract": { "module": "...", "version": "0.1.0", "exports": {...}, "imports": [...] },\n  "sub_modules": [{ "name": "...", "description": "...", "files_estimate": N }] // only if splitting\n}',
      agentDeveloper: "You are a Developer Agent. Implement a module according to its contract.\n\n## Module\n- Name: {module_name}\n- Path: {module_path}\n- Contract: {contract_json}\n\n## Environment\n{environment_info}\n\n## Existing Files\n{existing_files}\n\n## Process\n1. Study the contract \u2014 implement exactly what it defines.\n2. Generate \u2192 write \u2192 test each file (one at a time).\n3. If contract has issues, message the Architect Agent \u2014 don't silently work around.\n4. When all contract functions/types are implemented \u2192 done.\n\nStay within the contract. Don't read other modules' internals. Check environment before requiring packages.",
      agentReviewer: 'You are a Code Reviewer. Verify module implementation against its contract.\n\n## Module\n- Name: {module_name}\n- Contract: {contract_json}\n\n## Code\n{code_files}\n\n## Check\n1. Contract compliance: all exports implemented? Signatures correct? Imports declared?\n2. Quality: error handling, edge cases, naming consistency.\n3. Safety: no hardcoded secrets, no dangerous patterns.\n\nOutput pure JSON:\n{\n  "approved": true/false,\n  "issues": [{ "file": "...", "severity": "error"|"warning", "description": "...", "fix": "..." }],\n  "summary": "overall assessment"\n}',
      agentIntegrator: 'You are an Integration Agent. Assemble all modules into a complete project.\n\n## Project\n{project_name}\n\n## Modules\n{modules_summary}\n\n## Tasks\n1. Verify all modules are done and reviewed.\n2. Check import consistency across modules.\n3. Generate entry/main file that wires everything together.\n4. Generate missing config files (package.json, tsconfig, etc.).\n5. Output complete file manifest.\n\nOutput pure JSON:\n{\n  "success": true/false,\n  "entry_file": "path/to/main",\n  "all_files": ["file1", ...],\n  "integration_issues": [...],\n  "summary": "..."\n}',
      freeAgent: "\u4F60\u662F Handy\u3002\u4F60\u662F\u4E00\u4E2A\u5168\u80FD\u52A9\u624B\uFF0C\u4F60\u9700\u8981\u5C3D\u529B\u5B8C\u6210\u7528\u6237\u7684\u6307\u4EE4\uFF0C\u4E0D\u80FD\u8F7B\u6613\u653E\u5F03\uFF0C\u4F60\u9700\u8981\u786E\u4FDD\u4FE1\u606F\u7684\u51C6\u786E\u6027\u4EE5\u53CA\u4EFB\u52A1\u5B8C\u6210\u7684\u51C6\u786E\u6027\uFF0C\u6240\u4EE5\u5728\u6267\u884C\u4EFB\u52A1\u7684\u8FC7\u7A0B\u4E2D\u5E94\u8BE5\u5C3D\u91CF\u5148\u67E5\u8BE2\u540E\u884C\u52A8\uFF0C\u5148\u601D\u8003\u540E\u884C\u52A8\u3002\n## \u4F60\u62E5\u6709\u4EE5\u4E0B\u80FD\u529B\n1.\u4EE3\u7801\u811A\u672C\u6267\u884C\uFF0C\u4F60\u53EF\u901A\u8FC7\u4F7F\u7528execute_code\u5DE5\u5177\u6267\u884C\u4EE3\u7801\u811A\u672C\n\u4EE3\u7801\u811A\u672C\u73AF\u5883\u4FE1\u606F\u5982\u4E0B\n1.1Python:\u7248\u672C Python 3.14.4\u3002\n\u5DF2\u9884\u88C5\u7684\u7B2C\u4E09\u65B9\u5E93\uFF1Ahttpx\u3001Pillow\u3001mss\u3001pywinauto\u3001pywin32\u3001easyocr\u3001pynput\u3001psutil\u3001ddgs\u3001websockets\u3001playwright\u3001openpyxl\u3001python-docx\u3001python-pptx\u3002Python \u6807\u51C6\u5E93\u5168\u90E8\u53EF\u7528\uFF0C\u7F16\u5199\u4EE3\u7801\u811A\u672C\u65F6\u53EF\u76F4\u63A5\u4F7F\u7528\u8FD9\u4E9B\u5E93\u3002\n\u6C99\u7BB1\u7981\u6B62 os/subprocess/ctypes\u3002\n\u672A\u9884\u88C5\u7684\u5E93\u53EF\u901A\u8FC7 pip install \u5B89\u88C5\uFF08\u9700\u7528\u6237\u786E\u8BA4\uFF09\u3002\n1.2 JavaScript&HTML\nnew Function() \u6267\u884C\uFF0C\u65E0 Node.js \u8FD0\u884C\u65F6\u3002\u65E0\u6CD5\u5B89\u88C5 npm \u5305\u3002\niframe srcdoc \u9694\u79BB\u6E32\u67D3\u3002CSS/JS \u5E93\u53EF\u901A\u8FC7 CDN \u5F15\u5165\u3002\n1.3 SQL\n\u64CD\u4F5C\u672C\u5730 SQLite \u6570\u636E\u5E93\u3002DDL \u9ED8\u8BA4\u7981\u6B62\uFF08\u4F20 allowDDL: true \u53EF\u653E\u5F00\uFF09,\u5F53\u4F60\u8BA4\u4E3A\u6267\u884C\u6570\u636E\u5E93\u64CD\u4F5C\u4FE1\u606F\u6709\u5229\u4E8E\u4F60\u7684\u540E\u7EED\u5DE5\u4F5C\u65F6\uFF0C\u53EF\u6267\u884C\u6B64\u64CD\u4F5C\u3002\u67E5\u8BE2\u9650\u5236 1000 \u884C\u3002\n1.4 Shell\uFF08run_command\uFF09\nWindows cmd.exe \u73AF\u5883\u3002\u5371\u9669\u547D\u4EE4\u9ED1\u540D\u5355\u62E6\u622A\u3002\u6BCF\u6761\u9700\u7528\u6237\u786E\u8BA4\uFF0C\u9ED8\u8BA4 30 \u79D2\u8D85\u65F6\u3002\n1.5\u6587\u4EF6\u7CFB\u7EDF\uFF08glob_files / grep_files/read_file / write_file / \uFF09\n\u65B0\u589E\u7F16\u8F91\u64CD\u4F5C\u4EC5\u53EF\u5728workspace/ \u76EE\u5F55\u64CD\u4F5C\u3002\u652F\u6301\u6309\u6587\u4EF6\u540D\u6A21\u5F0F\u5339\u914D\u3001\u6309\u5185\u5BB9\u6B63\u5219\u641C\u7D22\u3001\u5206\u9875\u8BFB\u53D6\u3002\n\u5EFA\u8BAE\u5148\u5B9A\u4F4D\u9700\u67E5\u627E\u5185\u5BB9\u518Dread\uFF0C\u4EE5\u51CF\u5C11token\u6D88\u8017\n1.6 \u7F51\u7EDC\uFF08web_search / web_fetch\uFF09\n\u53EF\u8FDB\u884C\u7F51\u9875\u641C\u7D22\u3001\u7F51\u9875\u5168\u6587\u6293\u53D6\uFF08\u5E95\u5C42 Playwright Chromium \u6E32\u67D3 JS \u9875\u9762\uFF0C\u81EA\u52A8\u56DE\u9000 httpx\uFF09\u3002\u4E5F\u53EF\u5728 Python \u4E2D\u76F4\u63A5\u4F7F\u7528 httpx \u53D1 HTTP \u8BF7\u6C42\u3002\n1.7 \u5E73\u53F0\u53EF\u7528\u5DE5\u5177\n{menu}\n\u4F7F\u7528\u5E73\u53F0\u5DE5\u5177\u65F6\u9700\u8981\u4E86\u89E3\u5DE5\u5177\u7684\u53C2\u6570\u4FE1\u606F\u53CA\u57FA\u7840\u63CF\u8FF0\uFF0C\u5FC5\u586B\u7684\u53C2\u6570\u5FC5\u987B\u586B\u3002\n2. \u957F\u671F\u8BB0\u5FC6\uFF08agent_memory_update / recall_memory / search_chat_history/store_experience/save_code\uFF09\n\u53EF\u8BB0\u5F55\u7528\u6237\u504F\u597D\u548C\u9879\u76EE\u4FE1\u606F\uFF0C\u53EF\u641C\u7D22\u5386\u53F2\u8BB0\u5FC6\u548C\u5BF9\u8BDD,\u7528\u6237\u63D0\u51FA\u7684\u9700\u6C42\u5EFA\u8BAE\u4F7F\u7528agent_memory_update\uFF1B\u4EFB\u52A1\u6267\u884C\u8FC7\u7A0B\u4E2D\u603B\u7ED3\u7684\u7684\u884C\u4E3A\u603B\u7ED3\u6216\u53EF\u91CD\u590D\u5DE5\u4F5C\u6D41\u5982\u679C\u4F60\u8BA4\u4E3A\u9700\u8981\u4FDD\u5B58\u5EFA\u8BAEstore_experience\uFF0C\u4FDD\u5B58\u7684\u7ECF\u9A8C\u6559\u8BAD\u65B9\u6CD5\u9700\u8981\u5229\u4E8E\u4E0B\u4E00\u6B21\u67E5\u627E\uFF1B\u7F16\u5199\u7684\u4F60\u8BA4\u4E3A\u5177\u6709\u590D\u7528\u6027\u7684\u811A\u672C\u4EE3\u7801\u5EFA\u8BAEsave_code\u3002\n1.8\u573A\u666F\u53C2\u8003\n\n- \u6570\u636E\u5206\u6790\uFF1Apip install pandas matplotlib \u2192 Python \u5904\u7406\u5E76\u53EF\u89C6\u5316\n- REST API / \u4E0B\u8F7D\u6587\u4EF6\uFF1APython + httpx\uFF08\u5DF2\u9884\u88C5\uFF09\n- \u9759\u6001\u7F51\u9875\u6293\u53D6\uFF1A\u7F51\u9875\u6293\u53D6\u5DE5\u5177 \u6216 Python httpx\n- JS \u6E32\u67D3\u7684 SPA \u9875\u9762\uFF1A\u7F51\u9875\u6293\u53D6\u5DE5\u5177\uFF08Playwright \u81EA\u52A8\u6E32\u67D3\uFF09\n- \u6279\u91CF\u6587\u4EF6\u5904\u7406\uFF1A\u5148\u6309\u6A21\u5F0F\u5B9A\u4F4D\u6587\u4EF6 \u2192 Python \u6279\u91CF\u5904\u7406 \u2192 \u4FDD\u5B58\u7ED3\u679C\n- \u524D\u7AEF\u5C0F\u5DE5\u5177\uFF1AHTML \u751F\u6210 \u2192 \u4EA4\u4ED8\u5230\u5E94\u7528\u5E93\n- \u6570\u636E\u5E93\u5E94\u7528\uFF1ASQL \u5EFA\u8868 \u2192 \u6570\u636E\u64CD\u4F5C \u2192 HTML \u524D\u7AEF\u4EA4\u4ED8\n- \u590D\u6742\u9879\u76EE\uFF1A\u591A\u6587\u4EF6\u9879\u76EE\u751F\u6210\u5DE5\u5177\n- \u4FE1\u606F\u68C0\u7D22\uFF1A\u641C\u7D22 \u2192 \u6DF1\u5165\u9605\u8BFB"
    };
  }
});

// src/backend/server-entry.ts
var import_node_http = require("node:http");

// src/adapters/openai.ts
var OpenAIAdapter = class {
  constructor() {
    this.adapterId = "openai";
    this.displayName = "OpenAI / \u517C\u5BB9\u63A5\u53E3";
    this.defaultBaseUrl = "https://api.openai.com/v1";
  }
  async *chat({ messages, model, apiKey, baseUrl, tools, thinkingMode }) {
    const url = `${baseUrl ?? this.defaultBaseUrl}/chat/completions`;
    const bodyMessages = messages.map((m) => {
      if (m.role === "tool") {
        const msg = {
          role: "tool",
          content: typeof m.content === "string" ? m.content : m.content?.toString() ?? ""
        };
        if (m.toolCallId != null) msg["tool_call_id"] = m.toolCallId;
        return msg;
      }
      return toJson(m);
    });
    const body = {
      model,
      messages: bodyMessages,
      stream: true
    };
    if (tools && tools.length > 0) {
      body["tools"] = tools;
      console.log(`[openai] Sending ${tools.length} tool definitions, first:`, JSON.stringify(tools[0]).substring(0, 200));
    }
    if (thinkingMode) {
      body["thinking"] = { type: "enabled" };
      console.log("[openai] \u{1F9E0} thinking mode enabled");
    }
    const bodyJson = JSON.stringify(body);
    console.log("[openai] \u25B6 Request:", JSON.stringify(bodyMessages.map((m, i) => {
      const info = { idx: i, role: m.role };
      if (m.tool_calls) info.toolCalls = m.tool_calls.map((tc) => ({ id: tc.id, name: tc.function?.name }));
      if (m.tool_call_id) info.toolCallId = m.tool_call_id;
      if (Array.isArray(m.content)) {
        info.contentType = "array";
        info.contentParts = m.content.length;
        info.contentSummary = m.content.map((p) => {
          if (p.type === "text") return { type: "text", length: p.text?.length };
          if (p.type === "image_url") return { type: "image", urlLength: p.image_url?.url?.length };
          return { type: p.type };
        });
      } else if (typeof m.content === "string") {
        info.contentType = "string";
        info.contentLength = m.content.length;
      }
      return info;
    })));
    if (thinkingMode) {
      const debugMsgs = bodyMessages.map((m, i) => {
        const info = { idx: i, role: m.role };
        if (m.reasoning_content) info.hasRC = true;
        if (m.tool_calls) info.toolCalls = m.tool_calls.map((tc) => tc.function.name);
        if (m.tool_call_id) info.toolCallId = m.tool_call_id;
        if (m.role === "tool") info.contentPreview = m.content?.substring(0, 80);
        return info;
      });
      console.log("[MiMo DEBUG] request messages:", JSON.stringify(debugMsgs, null, 2));
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e4);
    let response;
    try {
      const bodyPreview = bodyJson.length > 2e3 ? bodyJson.substring(0, 2e3) + `...[+${bodyJson.length - 2e3} chars]` : bodyJson;
      console.log("[openai] \u{1F680} Final request \u2192 LLM provider:", {
        model,
        url,
        bodySize: bodyJson.length,
        bodySizeKB: Math.round(bodyJson.length / 1024),
        messageCount: bodyMessages.length,
        toolsCount: tools?.length ?? 0,
        thinkingMode: thinkingMode ?? false,
        bodyPreview
      });
      response = await fetch(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${apiKey}`,
          "Content-Type": "application/json"
        },
        body: bodyJson,
        signal: controller.signal
      });
      console.log("[openai] Response received:", {
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries())
      });
    } catch (e) {
      clearTimeout(timeout);
      console.error("[openai] Fetch error:", e);
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("LLM API request timed out (120s). The request body may be too large (e.g. images).");
      }
      throw e;
    }
    clearTimeout(timeout);
    if (!response.ok) {
      const errBody = await response.text().catch(() => "(no body)");
      console.error("[openai] API ERROR RESPONSE:", {
        status: response.status,
        statusText: response.statusText,
        body: errBody.substring(0, 500)
      });
      throw new Error(`OpenAI API error ${response.status}: ${errBody}`);
    }
    if (!response.body) {
      throw new Error("OpenAI API response has no body");
    }
    const toolCalls = /* @__PURE__ */ new Map();
    let fullText = "";
    let chunkCount = 0;
    let errorCount = 0;
    console.log("[openai] Starting to read SSE stream...");
    for await (const line of decodeStreamToLines(response.body)) {
      if (!line.startsWith("data: ")) continue;
      const data = line.substring(6).trim();
      if (data === "[DONE]") {
        console.log("[openai] SSE stream ended with [DONE]");
        break;
      }
      try {
        const json = JSON.parse(data);
        chunkCount++;
        if (chunkCount <= 3) {
          console.log(`[openai] SSE chunk ${chunkCount}:`, {
            hasChoices: !!json["choices"],
            choicesLength: json["choices"]?.length,
            hasDelta: !!json["choices"]?.[0]?.delta,
            deltaKeys: json["choices"]?.[0]?.delta ? Object.keys(json["choices"][0].delta) : []
          });
        }
        const choices = json["choices"];
        if (!choices || choices.length === 0) continue;
        const delta = choices[0]["delta"];
        if (!delta) continue;
        const rc = delta["reasoning_content"];
        if (rc && rc.length > 0) {
          yield `__REASONING__:${rc}`;
        }
        const content = delta["content"];
        if (content && content.length > 0) {
          fullText += content;
          yield content;
        }
        const toolCallDeltas = delta["tool_calls"];
        if (toolCallDeltas) {
          for (const tc of toolCallDeltas) {
            const index = tc["index"];
            if (!toolCalls.has(index)) {
              toolCalls.set(index, {
                id: "",
                type: "function",
                function: { name: "", arguments: "" }
              });
            }
            const entry = toolCalls.get(index);
            if (tc["id"] != null) entry["id"] = tc["id"];
            const func = tc["function"];
            if (func) {
              if (func["name"] != null) {
                entry["function"]["name"] = func["name"];
              }
              if (func["arguments"] != null) {
                const curr = entry["function"]["arguments"];
                entry["function"]["arguments"] = curr + func["arguments"];
              }
            }
          }
        }
      } catch (e) {
        errorCount++;
        if (errorCount <= 3) {
          console.warn("[openai] Failed to parse SSE chunk:", {
            data: data.substring(0, 100),
            error: e instanceof Error ? e.message : String(e)
          });
        }
      }
    }
    if (toolCalls.size > 0) {
      const calls = Array.from(toolCalls.values());
      console.log("[openai] Tool calls found:", {
        count: toolCalls.size,
        names: calls.map((c) => c.function?.name)
      });
      yield `__TOOLS__:${JSON.stringify(calls)}`;
    }
    console.log("[openai] SSE stream processing complete:", {
      chunkCount,
      errorCount,
      fullTextLength: fullText.length,
      toolCallsCount: toolCalls.size
    });
    if (fullText.length === 0 && toolCalls.size === 0) {
      console.warn("[openai] \u26A0 Empty response from LLM! This may indicate:");
      console.warn("  1. Request body too large (images)");
      console.warn("  2. Message format not supported by model");
      console.warn("  3. API rate limit or quota exceeded");
      console.warn("  4. Model returned empty content");
    }
    if (toolCalls.size > 0) return;
    const extracted = extractTextToolCalls(fullText);
    if (extracted.length > 0) {
      yield `__TOOLS__:${JSON.stringify(extracted)}`;
    }
  }
};
function toJson(m) {
  const json = { role: m.role };
  if (m.content != null) {
    json["content"] = m.content;
  } else if (m.role === "assistant") {
    json["content"] = "";
  }
  if (m.toolCallId != null) json["tool_call_id"] = m.toolCallId;
  if (m.toolCallName != null) json["name"] = m.toolCallName;
  if (m.toolCalls != null) json["tool_calls"] = m.toolCalls;
  if (m.reasoning_content != null && m.reasoning_content.length > 0) {
    json["reasoning_content"] = m.reasoning_content;
  }
  if (m.role === "assistant" && m.toolCalls) {
    console.debug(`[openai:toJson] assistant+tools: hasRC=${!!json["reasoning_content"]}, rcLen=${(m.reasoning_content ?? "").length}, content=${json["content"] ?? "null"}, toolCalls=${m.toolCalls.length}`);
  }
  return json;
}
async function* decodeStreamToLines(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      yield line;
    }
    if (done) {
      if (buffer.length > 0) yield buffer;
      break;
    }
  }
}
function extractTextToolCalls(text) {
  const calls = [];
  const seen = /* @__PURE__ */ new Set();
  let idx = 0;
  const addCall = (parsed) => {
    const name = parsed["name"];
    if (!name) return;
    const key = `${name}:${JSON.stringify(parsed["arguments"] ?? {})}`;
    if (seen.has(key)) return;
    seen.add(key);
    calls.push({
      id: `call_text_${idx++}`,
      type: "function",
      function: {
        name,
        arguments: JSON.stringify(parsed["arguments"] ?? {})
      }
    });
  };
  const toolCallRegex = /<tool_call>\s*([\s\S]*?)\s*<\/tool_call>/g;
  let match;
  while ((match = toolCallRegex.exec(text)) !== null) {
    try {
      addCall(JSON.parse(match[1]));
    } catch {
    }
  }
  const fenceRegex = /```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/g;
  while ((match = fenceRegex.exec(text)) !== null) {
    try {
      const block = match[1].trim();
      const parsed = JSON.parse(block);
      if (Array.isArray(parsed)) {
        for (const item of parsed) addCall(item);
      } else {
        addCall(parsed);
      }
    } catch {
      for (const line of match[1].split("\n")) {
        try {
          addCall(JSON.parse(line.trim()));
        } catch {
        }
      }
    }
  }
  if (calls.length === 0) {
    const jsonRegex = /\{\s*"name"\s*:\s*"[^"]+"\s*,\s*"arguments"\s*:\s*\{[\s\S]*?\}\s*\}/g;
    while ((match = jsonRegex.exec(text)) !== null) {
      try {
        addCall(JSON.parse(match[0]));
      } catch {
      }
    }
  }
  return calls;
}

// src/adapters/anthropic.ts
var AnthropicAdapter = class {
  constructor() {
    this.adapterId = "anthropic";
    this.displayName = "Anthropic";
    this.defaultBaseUrl = "https://api.anthropic.com";
  }
  async *chat({ messages, model, apiKey, baseUrl, tools, thinkingMode }) {
    const url = `${baseUrl ?? this.defaultBaseUrl}/v1/messages`;
    const systemMessages = messages.filter((m) => m.role === "system").map((m) => m.content?.toString() ?? "");
    const conversationMessages = convertMessagesForAnthropic(
      messages.filter((m) => m.role !== "system")
    );
    const body = {
      model,
      messages: conversationMessages,
      max_tokens: 4096,
      stream: true
    };
    if (systemMessages.length > 0) {
      body["system"] = systemMessages.join("\n");
    }
    if (tools && tools.length > 0) {
      body["tools"] = convertTools(tools);
    }
    if (thinkingMode) {
      body["thinking"] = { type: "enabled" };
      console.log("[anthropic] \u{1F9E0} thinking mode enabled");
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e4);
    let response;
    try {
      const bodyJson = JSON.stringify(body);
      const bodyPreview = bodyJson.length > 2e3 ? bodyJson.substring(0, 2e3) + `...[+${bodyJson.length - 2e3} chars]` : bodyJson;
      console.log("[anthropic] \u{1F680} Final request \u2192 LLM provider:", {
        model,
        url,
        bodySize: bodyJson.length,
        bodySizeKB: Math.round(bodyJson.length / 1024),
        messageCount: conversationMessages.length,
        systemPromptLen: systemMessages.join("\n").length,
        toolsCount: tools?.length ?? 0,
        thinkingMode: thinkingMode ?? false,
        bodyPreview
      });
      response = await fetch(url, {
        method: "POST",
        headers: {
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: bodyJson,
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeout);
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("Anthropic API request timed out (120s).");
      }
      throw e;
    }
    clearTimeout(timeout);
    if (!response.ok) {
      const errBody = await response.text().catch(() => "(no body)");
      throw new Error(`Anthropic API error ${response.status}: ${errBody}`);
    }
    if (!response.body) throw new Error("Anthropic API response has no body");
    const toolUseBlocks = /* @__PURE__ */ new Map();
    for await (const line of decodeStreamToLines2(response.body)) {
      if (!line.startsWith("data: ")) continue;
      const data = line.substring(6).trim();
      if (data === "[DONE]") break;
      try {
        const json = JSON.parse(data);
        const type = json["type"];
        if (type === "content_block_start") {
          const block = json["content_block"];
          if (block && block["type"] === "tool_use") {
            const index = json["index"];
            toolUseBlocks.set(index, {
              id: block["id"],
              name: block["name"],
              _jsonBuf: ""
            });
          }
        } else if (type === "content_block_delta") {
          const delta = json["delta"];
          if (delta?.["type"] === "input_json_delta") {
            const idx = json["index"];
            const partial = delta["partial_json"] ?? "";
            const block = toolUseBlocks.get(idx);
            if (block) block["_jsonBuf"] = block["_jsonBuf"] + partial;
          }
          const thinking = delta?.["thinking"];
          if (thinking && thinking.length > 0) yield `__REASONING__:${thinking}`;
          const signature = delta?.["signature"];
          if (signature && signature.length > 0) yield `__REASONING__:${signature}`;
          const text = delta?.["text"];
          if (text && text.length > 0) yield text;
        }
      } catch {
      }
    }
    if (toolUseBlocks.size > 0) {
      const calls = Array.from(toolUseBlocks.values()).map((b) => {
        let input;
        try {
          input = JSON.parse(b["_jsonBuf"]);
        } catch {
          input = {};
        }
        return {
          id: b["id"],
          function: {
            name: b["name"],
            arguments: JSON.stringify(input)
          }
        };
      });
      yield `__TOOLS__:${JSON.stringify(calls)}`;
    }
  }
};
function convertTools(tools) {
  return tools.map((t) => {
    const func = t["function"];
    return {
      name: func["name"],
      description: func["description"],
      input_schema: func["parameters"]
    };
  });
}
function convertMessagesForAnthropic(messages) {
  const result = [];
  for (const m of messages) {
    const content = m.content;
    if (m.role === "tool" && Array.isArray(content)) {
      const toolResultContent = [];
      for (const part of content) {
        const p = part;
        if (p["type"] === "image_url") {
          const iu = p["image_url"];
          let url = iu["url"];
          let mediaType;
          let data;
          if (url.startsWith("data:")) {
            const comma = url.indexOf(",");
            if (comma >= 0) {
              const header = url.substring(5, comma);
              const semicolon = header.indexOf(";");
              mediaType = semicolon >= 0 ? header.substring(0, semicolon) : header;
              data = url.substring(comma + 1);
            } else {
              data = url.substring(5);
            }
          } else {
            data = url;
          }
          toolResultContent.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType ?? "image/png",
              data
            }
          });
        } else if (p["type"] === "input_audio") {
          const audio = p["input_audio"];
          const data = audio["data"] ?? "";
          toolResultContent.push({ type: "text", text: `[Audio: ${data.substring(0, 200)}]` });
        } else if (p["type"] === "video_url") {
          const vu = p["video_url"];
          toolResultContent.push({ type: "text", text: `[Video: ${vu["url"] ?? ""}]` });
        } else if (p["type"] === "text") {
          toolResultContent.push({ type: "text", text: p["text"] });
        }
      }
      result.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.toolCallId ?? "",
          content: toolResultContent
        }]
      });
    } else if (Array.isArray(content)) {
      const parts = [];
      for (const part of content) {
        const p = part;
        if (p["type"] === "image_url") {
          const iu = p["image_url"];
          let url = iu["url"];
          let mediaType;
          let data;
          if (url.startsWith("data:")) {
            const comma = url.indexOf(",");
            if (comma >= 0) {
              const header = url.substring(5, comma);
              const semicolon = header.indexOf(";");
              mediaType = semicolon >= 0 ? header.substring(0, semicolon) : header;
              data = url.substring(comma + 1);
            } else {
              data = url.substring(5);
            }
          } else {
            data = url;
          }
          parts.push({
            type: "image",
            source: {
              type: "base64",
              media_type: mediaType ?? "image/png",
              data
            }
          });
        } else if (p["type"] === "input_audio") {
          const audio = p["input_audio"];
          const data = audio["data"] ?? "";
          parts.push({ type: "text", text: `[Audio provided: ${data.substring(0, 150)}...]` });
        } else if (p["type"] === "video_url") {
          const vu = p["video_url"];
          parts.push({ type: "text", text: `[Video URL: ${vu["url"] ?? ""}]` });
        } else if (p["type"] === "text") {
          parts.push({ type: "text", text: p["text"] });
        }
      }
      result.push({ role: m.role, content: parts });
    } else if (m.toolCalls && m.toolCalls.length > 0) {
      const blocks = [];
      if (content != null && content.toString().length > 0) {
        blocks.push({ type: "text", text: content.toString() });
      }
      for (const tc of m.toolCalls) {
        const func = tc["function"];
        let input;
        try {
          input = JSON.parse(func["arguments"]);
        } catch {
          input = {};
        }
        blocks.push({
          type: "tool_use",
          id: tc["id"],
          name: func["name"],
          input
        });
      }
      result.push({ role: "assistant", content: blocks });
    } else if (m.role === "tool") {
      result.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: m.toolCallId ?? "",
          content: content?.toString() ?? ""
        }]
      });
    } else {
      result.push({
        role: m.role,
        content: content?.toString() ?? ""
      });
    }
  }
  return result;
}
async function* decodeStreamToLines2(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) yield line;
    if (done) {
      if (buffer.length > 0) yield buffer;
      break;
    }
  }
}

// src/adapters/google.ts
var GoogleAdapter = class {
  constructor() {
    this.adapterId = "google";
    this.displayName = "Google Gemini";
    this.defaultBaseUrl = "https://generativelanguage.googleapis.com";
  }
  async *chat({ messages, model, apiKey, baseUrl, tools }) {
    const url = `${baseUrl ?? this.defaultBaseUrl}/v1beta/models/${model}:streamGenerateContent?key=${apiKey}`;
    const [contents, systemInstruction] = convertMessagesForGemini(messages);
    const body = { contents };
    if (systemInstruction != null) {
      body["systemInstruction"] = {
        parts: [{ text: systemInstruction }]
      };
    }
    if (tools && tools.length > 0) {
      body["tools"] = [{ functionDeclarations: convertTools2(tools) }];
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12e4);
    let response;
    try {
      const bodyJson = JSON.stringify(body);
      const bodyPreview = bodyJson.length > 2e3 ? bodyJson.substring(0, 2e3) + `...[+${bodyJson.length - 2e3} chars]` : bodyJson;
      console.log("[google] \u{1F680} Final request \u2192 LLM provider:", {
        model,
        url: url.substring(0, url.indexOf("?key=")) + "?key=***",
        bodySize: bodyJson.length,
        bodySizeKB: Math.round(bodyJson.length / 1024),
        messageCount: contents.length,
        systemInstruction: systemInstruction != null ? `${systemInstruction.substring(0, 100)}...` : null,
        toolsCount: tools?.length ?? 0,
        bodyPreview
      });
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: bodyJson,
        signal: controller.signal
      });
    } catch (e) {
      clearTimeout(timeout);
      if (e instanceof DOMException && e.name === "AbortError") {
        throw new Error("Gemini API request timed out (120s).");
      }
      throw e;
    }
    clearTimeout(timeout);
    if (!response.ok) {
      const errBody = await response.text().catch(() => "(no body)");
      throw new Error(`Gemini API error ${response.status}: ${errBody}`);
    }
    if (!response.body) throw new Error("Gemini API response has no body");
    const functionCalls = /* @__PURE__ */ new Map();
    for await (const line of decodeStreamToLines3(response.body)) {
      if (line.trim().length === 0) continue;
      try {
        const json = JSON.parse(line);
        const candidates = json["candidates"];
        if (!candidates || candidates.length === 0) continue;
        const content = candidates[0]["content"];
        const parts = content?.["parts"];
        if (!parts || parts.length === 0) continue;
        for (const part of parts) {
          const funcCall = part["functionCall"];
          if (funcCall) {
            const idx = functionCalls.size;
            functionCalls.set(idx, {
              id: `call_${idx}`,
              function: {
                name: funcCall["name"],
                arguments: JSON.stringify(funcCall["args"])
              }
            });
          }
          const text = part["text"];
          if (text && text.length > 0) {
            yield text;
          }
        }
      } catch {
      }
    }
    if (functionCalls.size > 0) {
      yield `__TOOLS__:${JSON.stringify(Array.from(functionCalls.values()))}`;
    }
  }
};
function convertTools2(tools) {
  return tools.map((t) => {
    const func = t["function"];
    return {
      name: func["name"],
      description: func["description"],
      parameters: func["parameters"]
    };
  });
}
function convertMessagesForGemini(messages) {
  const contents = [];
  let systemInstruction = null;
  for (const msg of messages) {
    const content = msg.content;
    if (msg.role === "system") {
      systemInstruction = content?.toString() ?? "";
      continue;
    }
    let role;
    switch (msg.role) {
      case "assistant":
        role = "model";
        break;
      case "tool":
        role = "function";
        break;
      default:
        role = "user";
    }
    const parts = [];
    if (msg.role === "tool" && Array.isArray(content)) {
      const textParts = [];
      for (const part of content) {
        const p = part;
        if (p["type"] === "image_url" || p["type"] === "input_audio") {
          const srcKey = p["type"] === "image_url" ? "image_url" : "input_audio";
          const src = p[srcKey];
          let url = src["url"] ?? src["data"];
          let mimeType;
          let data;
          if (url.startsWith("data:")) {
            const comma = url.indexOf(",");
            if (comma >= 0) {
              const header = url.substring(5, comma);
              const semicolon = header.indexOf(";");
              mimeType = semicolon >= 0 ? header.substring(0, semicolon) : header;
              data = url.substring(comma + 1);
            } else {
              data = url.substring(5);
            }
          } else {
            data = url;
          }
          parts.push({
            inlineData: {
              mimeType: mimeType ?? (p["type"] === "input_audio" ? "audio/wav" : "image/png"),
              data
            }
          });
        } else if (p["type"] === "video_url") {
          const vu = p["video_url"];
          textParts.push(`[Video: ${vu["url"] ?? ""}]`);
        } else if (p["type"] === "text") {
          textParts.push(p["text"]);
        }
      }
      parts.push({
        functionResponse: {
          name: msg.toolCallName ?? "",
          response: { output: textParts.join("\n") }
        }
      });
    } else if (Array.isArray(content)) {
      for (const part of content) {
        const p = part;
        if (p["type"] === "image_url" || p["type"] === "input_audio") {
          const srcKey = p["type"] === "image_url" ? "image_url" : "input_audio";
          const src = p[srcKey];
          let url = src["url"] ?? src["data"];
          let mimeType;
          let data;
          if (url.startsWith("data:")) {
            const comma = url.indexOf(",");
            if (comma >= 0) {
              const header = url.substring(5, comma);
              const semicolon = header.indexOf(";");
              mimeType = semicolon >= 0 ? header.substring(0, semicolon) : header;
              data = url.substring(comma + 1);
            } else {
              data = url.substring(5);
            }
          } else {
            data = url;
          }
          parts.push({
            inlineData: {
              mimeType: mimeType ?? (p["type"] === "input_audio" ? "audio/wav" : "image/png"),
              data
            }
          });
        } else if (p["type"] === "video_url") {
          const vu = p["video_url"];
          parts.push({ text: `[Video URL: ${vu["url"] ?? ""}]` });
        } else if (p["type"] === "text") {
          parts.push({ text: p["text"] });
        }
      }
    } else if (msg.toolCalls && msg.toolCalls.length > 0) {
      if (content != null && content.toString().length > 0) {
        parts.push({ text: content.toString() });
      }
      for (const tc of msg.toolCalls) {
        const func = tc["function"];
        let args;
        try {
          args = JSON.parse(func["arguments"]);
        } catch {
          args = {};
        }
        parts.push({
          functionCall: {
            name: func["name"],
            args
          }
        });
      }
    } else if (msg.role === "tool") {
      parts.push({
        functionResponse: {
          name: msg.toolCallName ?? "",
          response: { output: content?.toString() ?? "" }
        }
      });
    } else {
      parts.push({ text: content?.toString() ?? "" });
    }
    contents.push({ role, parts });
  }
  return [contents, systemInstruction];
}
async function* decodeStreamToLines3(body) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) yield line;
    if (done) {
      if (buffer.length > 0) yield buffer;
      break;
    }
  }
}

// src/services/llm-gateway/gateway.ts
var import_system_prompts = __toESM(require_system_prompts(), 1);

// src/utils/save-images.ts
var import_core = require("@tauri-apps/api/core");

// src/utils/platform.ts
var isTauri = () => typeof window !== "undefined" && !!window.__TAURI_INTERNALS__;

// src/utils/save-images.ts
async function saveImagesBeforeLLMCall(messages) {
  const imagesToSave = extractImageUrls(messages);
  if (imagesToSave.length === 0) return [];
  if (isTauri()) {
    return saveViaTauri(imagesToSave);
  }
  const saved = await saveViaNodeFs(imagesToSave);
  if (saved.length > 0) {
    console.log(`[saveImages] saved ${saved.length} image(s) via Node.js fs`);
  }
  return saved;
}
function extractImageUrls(messages) {
  const images = [];
  const seen = /* @__PURE__ */ new Set();
  for (let i = 0; i < messages.length; i++) {
    const content = messages[i].content;
    if (!Array.isArray(content)) continue;
    let imgIndex = 0;
    for (const part of content) {
      if (part.type === "image_url" && part.image_url?.url) {
        const url = part.image_url.url;
        if (url.startsWith("data:")) {
          const base64Part = url.includes(",") ? url.substring(url.indexOf(",") + 1) : url;
          let hash = 0;
          for (let j = 0; j < Math.min(base64Part.length, 8192); j++) {
            hash = (hash << 5) - hash + base64Part.charCodeAt(j) | 0;
          }
          const contentHash = Math.abs(hash).toString(36);
          const ext = url.includes("image/png") ? "png" : "jpg";
          const filename = `llm_img_${contentHash}.${ext}`;
          if (!seen.has(filename)) {
            seen.add(filename);
            images.push({ data: url, filename });
          }
          imgIndex++;
        }
      }
    }
  }
  return images;
}
async function saveViaTauri(images) {
  try {
    return await (0, import_core.invoke)("save_llm_images", { images });
  } catch {
    return [];
  }
}
async function saveViaNodeFs(images) {
  try {
    const [fs, nodePath] = await Promise.all([
      import("node:fs"),
      import("node:path")
    ]);
    const appData = process.env.APPDATA || (process.env.HOME ? nodePath.join(process.env.HOME, ".local", "share") : "");
    const dir = nodePath.join(appData, "com.handy.app", "public", "llm_images");
    fs.mkdirSync(dir, { recursive: true });
    const saved = [];
    for (const img of images) {
      const filePath = nodePath.join(dir, img.filename);
      const base64 = img.data.replace(/^data:image\/\w+;base64,/, "");
      fs.writeFileSync(filePath, Buffer.from(base64, "base64"));
      saved.push(filePath);
    }
    console.log(`[saveImages] \u{1F4BE} saved ${saved.length} image(s) via Node.js fs \u2192 ${dir}`);
    return saved;
  } catch (e) {
    console.error(`[saveImages] \u2717 saveViaNodeFs FAILED:`, e);
    return [];
  }
}

// src/services/llm-gateway/gateway.ts
var MAX_TOKENS_PER_SCENARIO = {
  ["desktopAutomation" /* desktopAutomation */]: 16e3,
  ["webAutomation" /* webAutomation */]: 16e3,
  ["phoneAutomation" /* phoneAutomation */]: 16e3,
  ["chat" /* chat */]: 96e3,
  ["watcher" /* watcher */]: 8e3,
  ["watcherResponse" /* watcherResponse */]: 8e3,
  ["recorderAnalysis" /* recorderAnalysis */]: 8e3,
  ["raw" /* raw */]: 96e3,
  ["codeGeneration" /* codeGeneration */]: 96e3,
  ["codeIteration" /* codeIteration */]: 96e3,
  ["taskDecomposer" /* taskDecomposer */]: 4e3,
  ["taskVerifier" /* taskVerifier */]: 8e3,
  ["docAgent" /* docAgent */]: 32e3,
  ["webAgent" /* webAgent */]: 16e3,
  ["codeAgent" /* codeAgent */]: 96e3,
  ["freeAgent" /* freeAgent */]: 96e3,
  ["adminAgent" /* adminAgent */]: 16e3,
  ["complexityJudge" /* complexityJudge */]: 8e3
};
var _prevRequestSig = "";
function summarizeContent(content) {
  if (content == null) return "null";
  if (typeof content === "string") {
    const preview = content.length > 120 ? content.substring(0, 120) + "..." : content;
    return `str(${content.length}) "${preview.replace(/\n/g, "\\n")}"`;
  }
  const parts = content.map((p) => {
    if (p.type === "text") return `text(${p.text?.length ?? 0})`;
    const url = p.image_url?.url ?? "";
    const len = url.startsWith("data:") ? url.length - url.indexOf(",") - 1 : url.length;
    return `image(base64:${len})`;
  });
  return `[${parts.join(", ")}]`;
}
function msgSignature(m) {
  const parts = [m.role];
  if (m.toolCallId) parts.push(`tcid:${m.toolCallId}`);
  if (m.toolCallName) parts.push(`tcname:${m.toolCallName}`);
  if (m.toolCalls) parts.push(`tc:${m.toolCalls.length}`);
  if (m.content != null) parts.push(summarizeContent(m.content));
  return parts.join("|");
}
function logRequest(provider, model, scenario, messages, tools) {
  const sig = messages.map(msgSignature).join("\n");
  const isSame = sig === _prevRequestSig;
  const header = `[LLM\u2192] ${provider}/${model} scenario=${scenario} msgs=${messages.length} tools=${tools?.length ?? 0}`;
  if (isSame) {
    console.log(`${header} (unchanged)`);
    return;
  }
  const prevLines = _prevRequestSig.split("\n");
  const newLines = sig.split("\n");
  const minLen = Math.min(prevLines.length, newLines.length);
  let diffStart = 0;
  for (let i = 0; i < minLen; i++) {
    if (prevLines[i] !== newLines[i]) {
      diffStart = i;
      break;
    }
    diffStart = i + 1;
  }
  console.log(`${header} \u2014 ${diffStart} unchanged, +${messages.length - diffStart} new`);
  for (let i = diffStart; i < messages.length; i++) {
    const m = messages[i];
    console.log(`  [${i}] ${m.role}: ${summarizeContent(m.content)}`);
    if (m.toolCalls && m.toolCalls.length > 0) {
      for (const tc of m.toolCalls) {
        const fn = tc.function;
        const args = fn.arguments.length > 100 ? fn.arguments.substring(0, 100) + "..." : fn.arguments;
        console.log(`    \u2192 ${fn.name}(${args})`);
      }
    }
  }
  _prevRequestSig = sig;
}
var LlmGateway = class {
  constructor() {
    this._adapters = {
      openai: new OpenAIAdapter(),
      anthropic: new AnthropicAdapter(),
      google: new GoogleAdapter()
    };
  }
  // ── 系统提示构建 ──
  buildSystemPrompt(scenario, goal = "", extra, requiredTool = false) {
    let base;
    switch (scenario) {
      case "chat" /* chat */:
        base = extra ? `${import_system_prompts.default.chat}

${extra}` : import_system_prompts.default.chat;
        break;
      case "desktopAutomation" /* desktopAutomation */:
        base = import_system_prompts.default.desktopAutomation.replaceAll("{goal}", goal);
        break;
      case "webAutomation" /* webAutomation */:
        base = import_system_prompts.default.webAutomation.replaceAll("{goal}", goal);
        break;
      case "phoneAutomation" /* phoneAutomation */:
        base = import_system_prompts.default.phoneAutomation.replaceAll("{goal}", goal);
        break;
      case "watcherResponse" /* watcherResponse */:
        base = import_system_prompts.default.watcherResponse.replaceAll("{goal}", goal);
        break;
      case "watcher" /* watcher */:
      case "raw" /* raw */:
        base = extra ?? "";
        break;
      case "recorderAnalysis" /* recorderAnalysis */:
        base = import_system_prompts.default.recorderAnalysis ?? "";
        break;
      case "codeGeneration" /* codeGeneration */:
        base = import_system_prompts.default.codeGeneration;
        break;
      case "codeIteration" /* codeIteration */:
        base = import_system_prompts.default.codeIteration;
        break;
      case "adminAgent" /* adminAgent */:
        base = import_system_prompts.default.adminAgent.replace("{tools_list}", extra ?? "");
        break;
      case "complexityJudge" /* complexityJudge */:
        base = import_system_prompts.default.complexityJudge.replace("{user_request}", goal).replace("{existing_tools}", extra ?? "");
        break;
      case "taskDecomposer" /* taskDecomposer */:
        base = import_system_prompts.default.taskDecomposer;
        break;
      case "taskVerifier" /* taskVerifier */:
        base = import_system_prompts.default.taskVerifier;
        break;
      case "docAgent" /* docAgent */:
        base = import_system_prompts.default.docAgent ?? import_system_prompts.default.chat;
        break;
      case "webAgent" /* webAgent */:
        base = import_system_prompts.default.webAutomation.replaceAll("{goal}", goal);
        break;
      case "codeAgent" /* codeAgent */:
        base = import_system_prompts.default.codeAgent ?? import_system_prompts.default.chat;
        break;
      case "freeAgent" /* freeAgent */:
        base = import_system_prompts.default.freeAgent ?? import_system_prompts.default.chat;
        break;
    }
    if (requiredTool) {
      return `${base}

You MUST respond ONLY with function calls \u2014 do not output any text.`;
    }
    return base;
  }
  withSystemPrompt(messages, systemPrompt) {
    if (systemPrompt.length === 0) return messages;
    return [{ role: "system", content: systemPrompt }, ...messages];
  }
  // ── Tokens 估算 ──
  estimateTokens(messages) {
    let chars = 0;
    for (const m of messages) {
      const c = m.content;
      if (typeof c === "string") {
        chars += c.length > 8e3 ? 8e3 : c.length;
      } else if (Array.isArray(c)) {
        chars += JSON.stringify(c).length > 8e3 ? 8e3 : JSON.stringify(c).length;
      }
      if (m.toolCalls) chars += JSON.stringify(m.toolCalls).length;
    }
    return Math.floor(chars / 2);
  }
  checkLength(scenario, messages) {
    const maxTokens = MAX_TOKENS_PER_SCENARIO[scenario] ?? 32e3;
    const estimated = this.estimateTokens(messages);
    if (estimated > maxTokens) {
      return { ok: false, estimatedTokens: estimated, maxTokens, warning: `\u5185\u5BB9\u8FC7\u957F\uFF1A\u9884\u4F30 ${estimated} tokens\uFF0C\u4E0A\u9650 ${maxTokens} tokens\u3002` };
    }
    return { ok: true, estimatedTokens: estimated, maxTokens };
  }
  // ── 核心：流式 LLM 调用 ──
  async *chatStream(params) {
    const { scenario, messages, provider, apiKey, tools, goal = "" } = params;
    const skipCache = true;
    const supportsTools = provider.supportsTools !== false;
    const adapterTools = supportsTools ? tools : void 0;
    let fullMessages = messages;
    if (!supportsTools && tools && tools.length > 0) {
      fullMessages = [...messages, { role: "system", content: formatToolsForPrompt(tools) }];
    }
    saveImagesBeforeLLMCall(fullMessages);
    console.log("[LlmGateway] \u25B6", JSON.parse(JSON.stringify({
      scenario,
      provider: provider.type + "/" + provider.model,
      messageCount: fullMessages.length,
      tools: adapterTools?.length,
      goal,
      thinkingMode: provider.thinkingMode
    })));
    const check = this.checkLength(scenario, fullMessages);
    if (!check.ok) {
      yield `__ERROR__:${check.warning}`;
      return;
    }
    const adapter = this._adapters[provider.type];
    if (!adapter) {
      yield `__ERROR__:Unknown provider type: ${provider.type}`;
      return;
    }
    logRequest(provider.type, provider.model, scenario, fullMessages, adapterTools);
    const stream = adapter.chat({
      messages: fullMessages,
      model: provider.model,
      apiKey,
      baseUrl: provider.baseUrl,
      tools: adapterTools,
      thinkingMode: provider.thinkingMode
    });
    let fullResponse = "";
    for await (const chunk of stream) {
      fullResponse += chunk;
      yield chunk;
    }
    console.log("[LlmGateway] \u25C0", { responseLen: fullResponse.length });
  }
  // ── 核心：工具调用 ──
  async callWithTools(params) {
    const { scenario, messages, provider, apiKey, tools, goal = "", requiredTool = false } = params;
    const stream = this.chatStream({ scenario, messages, provider, apiKey, tools, goal, skipCache: true });
    let toolJson;
    let responseText = "";
    let reasoningContent = "";
    for await (const chunk of stream) {
      if (chunk.startsWith("__TOOLS__:")) {
        const m = chunk.match(/__TOOLS__:(\[[\s\S]*\])/);
        toolJson = m ? m[1] : chunk.substring(10);
      } else if (chunk.startsWith("__ERROR__:")) {
        throw new Error(chunk.substring(10));
      } else if (chunk.startsWith("__REASONING__:")) {
        reasoningContent += chunk.substring(14);
      } else {
        responseText += chunk;
      }
    }
    if (toolJson == null) {
      if (requiredTool) throw new Error("No tool calls in response");
      return { toolCalls: [], assistantMessage: { role: "assistant", content: responseText || null, reasoning_content: reasoningContent || void 0 } };
    }
    const list = JSON.parse(toolJson);
    const toolCallObjs = list.map((tc) => ({
      id: tc["id"],
      type: "function",
      function: {
        name: tc["function"]["name"],
        arguments: tc["function"]["arguments"]
      }
    }));
    const results = toolCallObjs.map((tc) => ({
      id: tc.id,
      name: tc.function.name,
      arguments: JSON.parse(tc.function.arguments)
    }));
    const assistantMessage = { role: "assistant", content: responseText || null, toolCalls: toolCallObjs, reasoning_content: reasoningContent || void 0 };
    console.debug(`[LlmGateway] callWithTools: hasRC=${!!reasoningContent}, rcLen=${reasoningContent.length}, tools=${results.map((t) => t.name).join(",")}`);
    return { toolCalls: results, assistantMessage };
  }
  dispose() {
  }
};
function formatToolsForPrompt(tools) {
  const toolDescs = tools.map((t) => {
    const func = t["function"];
    return { name: func["name"], description: func["description"], parameters: func["parameters"] };
  });
  return '\n\n## Available Tools\n\nYou have access to the following tools. To use a tool, you MUST respond with ONLY a tool call in this format:\n\n<tool_call>\n{"name": "<tool_name>", "arguments": {<params>}}\n</tool_call>\n\n' + JSON.stringify(toolDescs, null, 2);
}

// src/backend/llm-executor.ts
var _gateway = null;
function getGateway() {
  if (!_gateway) {
    _gateway = new LlmGateway();
  }
  return _gateway;
}
async function executeCall(params) {
  const gateway = getGateway();
  const result = await gateway.callWithTools({
    scenario: params.scenario,
    messages: params.messages,
    provider: params.provider,
    apiKey: params.apiKey,
    tools: params.tools ?? [],
    goal: params.goal,
    requiredTool: params.requiredTool,
    skipCache: params.skipCache
  });
  return {
    responseText: typeof result.assistantMessage.content === "string" ? result.assistantMessage.content : "",
    toolCalls: result.toolCalls,
    assistantMessage: result.assistantMessage
  };
}
function executeStream(params) {
  const gateway = getGateway();
  return gateway.chatStream({
    scenario: params.scenario,
    messages: params.messages,
    provider: params.provider,
    apiKey: params.apiKey,
    tools: params.tools,
    goal: params.goal,
    skipCache: params.skipCache
  });
}

// src/backend/handlers.ts
var import_node_child_process = require("node:child_process");
function unwrapParams(params) {
  return params;
}
async function buildClassifierPrompt() {
  const { default: prompts } = await Promise.resolve().then(() => __toESM(require_system_prompts(), 1));
  return prompts.intentClassifier;
}
function parseIntentResponse(raw) {
  let cleaned = raw.trim();
  if (cleaned.startsWith("```")) {
    cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, "").replace(/\n?```\s*$/, "");
  }
  try {
    const obj = JSON.parse(cleaned);
    if (!obj.tasks || !Array.isArray(obj.tasks)) throw new Error("Missing tasks array");
    for (const task of obj.tasks) {
      if (!task.type || !task.goal || !task.action) throw new Error("Invalid task");
    }
    return { tasks: obj.tasks, response: obj.response ?? "\u597D\u7684\uFF0C\u6211\u6765\u5904\u7406\u3002" };
  } catch {
    return {
      tasks: [{ name: raw.substring(0, 30), type: "once", goal: raw, action: { type: "agent_execute", goalTemplate: raw } }],
      response: "\u597D\u7684\uFF0C\u6211\u6765\u5904\u7406\u3002"
    };
  }
}
async function* handleIntentClassifier(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const prompt = await buildClassifierPrompt();
  const stream = executeStream({
    scenario: "watcher" /* watcher */,
    messages: [
      { role: "system", content: prompt },
      { role: "user", content: p.userInput }
    ],
    provider,
    apiKey,
    goal: p.userInput
  });
  let responseText = "";
  for await (const chunk of stream) {
    if (chunk.startsWith("__REASONING__:") || chunk.startsWith("__ERROR__:")) {
      yield chunk;
    } else if (chunk.startsWith("__TOOLS__:")) {
      yield chunk;
    } else {
      responseText += chunk;
      yield chunk;
    }
  }
  const parsed = parseIntentResponse(responseText);
  yield `__TOOLS__:${JSON.stringify(parsed)}`;
}
async function handleVerification(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const imageUrl = p.screenshotBase64.startsWith("data:") ? p.screenshotBase64 : `data:image/jpeg;base64,${p.screenshotBase64}`;
  const messages = [];
  if (p.contextMessages && p.contextMessages.length > 0) {
    messages.push(...p.contextMessages);
  }
  messages.push({
    role: "user",
    content: [
      { type: "image_url", image_url: { url: imageUrl } },
      {
        type: "text",
        text: `Original goal: "${p.goal}"

Look at the screenshot above. Is the goal FULLY completed?

Answer with ONLY one word on the first line: YES or NO.
If NO, describe what is still missing on the next line.

Be strict: even small issues mean the task is NOT complete. Do NOT use any tool \u2014 just answer in plain text.`
      }
    ]
  });
  try {
    const { responseText } = await executeCall({
      scenario: "desktopAutomation" /* desktopAutomation */,
      messages,
      provider,
      apiKey,
      goal: p.goal,
      skipCache: true
    });
    const trimmed = responseText.trim();
    const firstLine = trimmed.split("\n")[0]?.trim().toUpperCase() ?? "";
    const completed = firstLine === "YES" || firstLine.startsWith("YES");
    const feedback = completed ? "Task verified complete" : firstLine.startsWith("NO") ? trimmed.substring(trimmed.indexOf("\n") + 1).trim() || "Task appears incomplete" : trimmed || "Task appears incomplete";
    return { completed, feedback, screenshot: p.screenshotBase64 };
  } catch {
    return { completed: true, feedback: "Verification error \u2014 trusted agent", screenshot: p.screenshotBase64 };
  }
}
function handleChat(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "chat" /* chat */,
    messages: p.messages,
    provider,
    apiKey,
    tools: p.tools,
    goal: p.goal,
    skipCache: p.skipCache
  });
}
function handleCodeGeneration(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "codeGeneration" /* codeGeneration */,
    messages: [{ role: "user", content: p.prompt }],
    provider,
    apiKey
  });
}
function handleCodeIteration(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "codeIteration" /* codeIteration */,
    messages: [{
      role: "user",
      content: `The following code produced an error:

Code:
\`\`\`
${p.code}
\`\`\`

Error:
${p.error}

Please fix the code and explain the fix.`
    }],
    provider,
    apiKey
  });
}
function buildVisionPrompt(goal, existingAnnotations) {
  const existingBlock = existingAnnotations ? `
Previously known elements (keep their names):
${existingAnnotations}
` : "";
  return `Task goal: "${goal}"${existingBlock}
Analyze the screenshot and identify ALL interactive UI elements.
Return a JSON array of objects with:
- label: semantic name in Chinese (e.g. "\u53D1\u9001\u6309\u94AE", "\u641C\u7D22\u6846")
- description: location description (e.g. "\u804A\u5929\u7A97\u53E3\u5E95\u90E8\u53F3\u4FA7")
- keywords: array of search keywords (Chinese + English)
- relativeX: 0-1, x position relative to image width
- relativeY: 0-1, y position relative to image height
- relativeWidth: 0-1, element width / image width
- relativeHeight: 0-1, element height / image height
- type: "interactive" or "content"

Only output the JSON array, nothing else.`;
}
function parseVisionJson(text) {
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (match) return JSON.parse(match[0]);
    return [];
  } catch {
    return [];
  }
}
async function handleUIVisionAnalyze(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const prompt = buildVisionPrompt(p.goal, p.existingAnnotations);
  const { responseText } = await executeCall({
    scenario: "raw" /* raw */,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: p.screenshotBase64 } },
        { type: "text", text: prompt }
      ]
    }],
    provider,
    apiKey
  });
  return parseVisionJson(responseText);
}
async function handleUIVisionAnnotate(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const elementDesc = p.elements.slice(0, 30).map(
    (n) => `[${n["role"]}] "${n["name"] || "(unnamed)"}"${n["bounds"] ? ` @(${n["bounds"]["left"]},${n["bounds"]["top"]})` : ""}`
  ).join("\n");
  const prompt = `Task goal: "${p.goal}"

Available UI elements in the target window:
${elementDesc}

Total: ${p.elements.length} elements.

For each element relevant to the task, provide a Chinese semantic annotation in JSON format:
[{"label": "\u4E2D\u6587\u8BED\u4E49\u540D", "description": "\u4F4D\u7F6E\u63CF\u8FF0", "role": "\u539F\u59CBrole", "name": "\u539F\u59CBname", "relativeX": 0.5, "relativeY": 0.3, "keywords": ["\u4E2D\u6587\u5173\u952E\u8BCD", "\u82F1\u6587\u5173\u952E\u8BCD"]}]

Include ALL interactive elements.`;
  const { responseText } = await executeCall({
    scenario: "raw" /* raw */,
    messages: [{ role: "user", content: prompt }],
    provider,
    apiKey
  });
  return parseVisionJson(responseText);
}
async function handleUIVisionOcrClassify(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const ocrDesc = p.ocrItems.map(
    (item, i) => `[${i}] "${item.text}" @ (${item.bbox.left}, ${item.bbox.top})`
  ).join("\n");
  const prompt = `Task goal: "${p.goal}"

OCR text results:
${ocrDesc}

Identify interactive elements from these OCR results. Return JSON array of objects with: label (semantic name), keywords (array), relativeX (0-1), relativeY (0-1).`;
  const { responseText } = await executeCall({
    scenario: "raw" /* raw */,
    messages: [{ role: "user", content: prompt }],
    provider,
    apiKey
  });
  return parseVisionJson(responseText);
}
async function handleScreenAnalysisDiff(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const { responseText } = await executeCall({
    scenario: "watcherResponse" /* watcherResponse */,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: p.beforeScreenshot } },
        { type: "image_url", image_url: { url: p.afterScreenshot } },
        { type: "text", text: `Goal: "${p.goal}"

Compare the two screenshots above (BEFORE \u2192 AFTER). Is there a meaningful change?
Answer in JSON: {"changed": true/false, "description": "what changed", "confidence": 0.0-1.0}` }
      ]
    }],
    provider,
    apiKey,
    goal: p.goal
  });
  try {
    const match = responseText.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      return { changed: !!parsed.changed, description: parsed.description ?? "", confidence: parsed.confidence ?? 0.5 };
    }
  } catch {
  }
  return { changed: false, description: "Could not parse analysis", confidence: 0 };
}
async function handleScreenAnalysisRegions(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const { responseText } = await executeCall({
    scenario: "watcherResponse" /* watcherResponse */,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: p.screenshot } },
        { type: "text", text: `Goal: "${p.goal}"

Identify regions in this screenshot that should be monitored for changes.
Return JSON: {"regions": [{"description": "...", "x": 0.1, "y": 0.2, "width": 0.3, "height": 0.1, "label": "\u6D88\u606F\u5217\u8868"}]}
Coordinates are 0-1 relative to image size.` }
      ]
    }],
    provider,
    apiKey,
    goal: p.goal
  });
  try {
    const match = responseText.match(/\{[\s\S]*\}/);
    if (match) return JSON.parse(match[0]);
  } catch {
  }
  return { regions: [] };
}
async function handleScreenAnalysisOcr(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const { responseText } = await executeCall({
    scenario: "watcherResponse" /* watcherResponse */,
    messages: [{
      role: "user",
      content: `Goal: "${p.goal}"

OCR detected texts:
${p.ocrTexts.join("\n")}

Analyze what changed and describe it in one sentence.`
    }],
    provider,
    apiKey,
    goal: p.goal
  });
  return { analysis: responseText.trim() };
}
async function handleScreenAnalysisInterruption(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const stepsText = p.completedSteps.join("\n");
  const { responseText } = await executeCall({
    scenario: "watcherResponse" /* watcherResponse */,
    messages: [{
      role: "user",
      content: [
        { type: "image_url", image_url: { url: p.screenshot } },
        { type: "text", text: `Goal: "${p.goal}"

Completed steps:
${stepsText}

Look at the screenshot. Is the task complete? If yes, say DONE. If not, say CONTINUE and describe the next step.` }
      ]
    }],
    provider,
    apiKey,
    goal: p.goal
  });
  return { decision: responseText.trim() };
}
function handleDesktopAutomation(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "desktopAutomation" /* desktopAutomation */,
    messages: p.messages,
    provider,
    apiKey,
    tools: p.tools,
    goal: p.goal,
    skipCache: p.skipCache
  });
}
function parseSimpleToolCalls(toolJson, responseText) {
  if (toolJson) {
    try {
      const list = JSON.parse(toolJson);
      return list.map((tc) => {
        const func = tc["function"];
        if (func) {
          return { name: func["name"], arguments: JSON.parse(func["arguments"]) };
        }
        return { name: tc["name"], arguments: tc["arguments"] ?? {} };
      });
    } catch {
    }
  }
  try {
    const match = responseText.match(/```json\s*\n?([\s\S]*?)\n?\s*```|\[[\s\S]*\]/);
    if (match) {
      const json = JSON.parse(match[1] || match[0]);
      const arr = Array.isArray(json) ? json : [json];
      return arr.map((item) => ({
        name: item["name"] || "unknown",
        arguments: item["arguments"] ?? item
      }));
    }
  } catch {
  }
  return [];
}
async function* handleDesktopAutomationTools(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const stream = executeStream({
    scenario: "desktopAutomation" /* desktopAutomation */,
    messages: p.messages,
    provider,
    apiKey,
    tools: p.tools,
    goal: p.goal,
    skipCache: p.skipCache
  });
  let responseText = "";
  let toolJson;
  for await (const chunk of stream) {
    if (chunk.startsWith("__REASONING__:") || chunk.startsWith("__ERROR__:")) {
      yield chunk;
    } else if (chunk.startsWith("__TOOLS__:")) {
      toolJson = chunk.substring(10);
    } else {
      responseText += chunk;
      yield chunk;
    }
  }
  const toolCalls = parseSimpleToolCalls(toolJson, responseText);
  yield `__TOOLS__:${JSON.stringify({ toolCalls, responseText })}`;
}
function handleTaskDecomposer(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "taskDecomposer" /* taskDecomposer */,
    messages: p.messages,
    provider,
    apiKey,
    tools: p.tools,
    goal: p.goal,
    skipCache: p.skipCache
  });
}
function handleTaskVerifier(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "taskVerifier" /* taskVerifier */,
    messages: p.messages,
    provider,
    apiKey,
    tools: p.tools,
    goal: p.goal,
    skipCache: p.skipCache
  });
}
function handleDocAgent(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "docAgent" /* docAgent */,
    messages: p.messages,
    provider,
    apiKey,
    tools: p.tools,
    goal: p.goal,
    skipCache: p.skipCache
  });
}
function handleWebAgent(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "webAgent" /* webAgent */,
    messages: p.messages,
    provider,
    apiKey,
    tools: p.tools,
    goal: p.goal,
    skipCache: p.skipCache
  });
}
function handleCodeAgent(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "codeAgent" /* codeAgent */,
    messages: p.messages,
    provider,
    apiKey,
    tools: p.tools,
    goal: p.goal,
    skipCache: p.skipCache
  });
}
function handleFreeAgent(provider, apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  return executeStream({
    scenario: "freeAgent" /* freeAgent */,
    messages: p.messages,
    provider,
    apiKey,
    tools: p.tools,
    goal: p.goal,
    skipCache: p.skipCache
  });
}
var DANGEROUS_PATTERNS = [
  { pattern: /\brm\s+(-[rRf]+\s+|--recursive)/i, reason: "\u9012\u5F52\u5220\u9664\u6587\u4EF6\uFF08rm -rf\uFF09" },
  { pattern: /\brmdir\s+\/s/i, reason: "\u9012\u5F52\u5220\u9664\u76EE\u5F55\uFF08rmdir /s\uFF09" },
  { pattern: /\bdel\s+\/s/i, reason: "\u9012\u5F52\u5220\u9664\u6587\u4EF6\uFF08del /s\uFF09" },
  { pattern: /\bformat\s+[a-z]:/i, reason: "\u683C\u5F0F\u5316\u78C1\u76D8" },
  { pattern: /\breg\s+delete\b/i, reason: "\u5220\u9664\u6CE8\u518C\u8868\u9879" },
  { pattern: /\bregedit\b/i, reason: "\u6CE8\u518C\u8868\u7F16\u8F91\u5668" },
  { pattern: /\bshutdown\b/i, reason: "\u5173\u673A/\u91CD\u542F" },
  { pattern: /\breboot\b/i, reason: "\u91CD\u542F\u7CFB\u7EDF" },
  { pattern: /\btaskkill\b/i, reason: "\u7EC8\u6B62\u8FDB\u7A0B\uFF08taskkill\uFF09" },
  { pattern: /\btskill\b/i, reason: "\u7EC8\u6B62\u8FDB\u7A0B\uFF08tskill\uFF09" },
  { pattern: /\bStop-Process\b/i, reason: "\u7EC8\u6B62\u8FDB\u7A0B\uFF08PowerShell\uFF09" },
  { pattern: /\bwmic\b.*\b(delete|terminate|call)\b/i, reason: "\u7EC8\u6B62\u8FDB\u7A0B\uFF08WMI\uFF09" },
  { pattern: /\bnet\s+user\b.*\b\/delete\b/i, reason: "\u5220\u9664\u7528\u6237\u8D26\u6237" },
  { pattern: /\bcacls\b|\bicacls\b.*\/g/i, reason: "\u4FEE\u6539\u6587\u4EF6\u6743\u9650" },
  { pattern: /\|\s*(sh|bash|cmd|powershell)\b/i, reason: "\u7BA1\u9053\u6CE8\u5165\u5230 shell" },
  { pattern: /\bcurl\b.*\|\s*(sh|bash)\b/i, reason: "\u4E0B\u8F7D\u5E76\u6267\u884C\uFF08curl|sh\uFF09" },
  { pattern: /\bpowershell\b.*\b(iex|invoke-expression)\b/i, reason: "PowerShell \u8FDC\u7A0B\u6267\u884C" },
  { pattern: /\beval\s*\(/i, reason: "eval \u6267\u884C" },
  { pattern: /\bC:\\Windows\b/i, reason: "\u64CD\u4F5C\u7CFB\u7EDF\u76EE\u5F55" },
  { pattern: /\bC:\\System32\b/i, reason: "\u7CFB\u7EDF\u76EE\u5F55" }
];
function checkCommandSafety(command) {
  for (const { pattern, reason } of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) return reason;
  }
  return null;
}
async function handleRunCommand(_provider, _apiKey, rawParams) {
  const p = unwrapParams(rawParams);
  const { command, cwd, timeout_ms = 3e4 } = p;
  if (!command) {
    return { ok: false, stdout: "", stderr: "command is required", exitCode: -1, method: "error" };
  }
  const dangerReason = checkCommandSafety(command);
  if (dangerReason) {
    return { ok: false, stdout: "", stderr: `\u26A0\uFE0F \u547D\u4EE4\u88AB\u62E6\u622A\uFF1A${dangerReason}`, exitCode: -1, method: "blocked" };
  }
  const execCommand = command;
  const t0 = Date.now();
  console.log(`[run_command] START cmd="${execCommand}" cwd="${cwd || "."}" timeout=${timeout_ms}ms`);
  return new Promise((resolve) => {
    const child = (0, import_node_child_process.exec)(
      execCommand,
      { cwd, timeout: timeout_ms, windowsHide: true, encoding: "buffer", maxBuffer: 50 * 1024 * 1024 },
      (error, stdout, stderr) => {
        const elapsed = Date.now() - t0;
        const dec = (buf) => {
          if (!buf || buf.length === 0) return "";
          if (typeof buf === "string") return buf;
          try {
            return new TextDecoder("gbk").decode(buf);
          } catch {
            return buf.toString("utf-8");
          }
        };
        const outStr = dec(stdout);
        const errStr = error && !stderr ? error.message : dec(stderr);
        console.log(`[run_command] END ${elapsed}ms exit=${error?.code ?? 0} stdout=${outStr.length}B`);
        resolve({
          ok: !error,
          stdout: outStr,
          stderr: errStr,
          exitCode: error?.code ?? 0,
          method: "backend"
        });
      }
    );
    setTimeout(() => {
      try {
        child.kill("SIGTERM");
      } catch {
      }
    }, timeout_ms);
  });
}

// src/backend/middleware.ts
var routes = {
  ["/api/agent/intent-classifier" /* intentClassifier */]: { handler: handleIntentClassifier, streaming: true },
  ["/api/agent/verification" /* verification */]: { handler: handleVerification, streaming: false },
  ["/api/agent/chat" /* chat */]: { handler: handleChat, streaming: true },
  ["/api/agent/code-generation" /* codeGeneration */]: { handler: handleCodeGeneration, streaming: true },
  ["/api/agent/code-iteration" /* codeIteration */]: { handler: handleCodeIteration, streaming: true },
  ["/api/agent/ui-vision/analyze-screenshot" /* uiVisionAnalyze */]: { handler: handleUIVisionAnalyze, streaming: false },
  ["/api/agent/ui-vision/annotate-elements" /* uiVisionAnnotate */]: { handler: handleUIVisionAnnotate, streaming: false },
  ["/api/agent/ui-vision/ocr-classify" /* uiVisionOcrClassify */]: { handler: handleUIVisionOcrClassify, streaming: false },
  ["/api/agent/screen-analysis/diff" /* screenAnalysisDiff */]: { handler: handleScreenAnalysisDiff, streaming: false },
  ["/api/agent/screen-analysis/regions" /* screenAnalysisRegions */]: { handler: handleScreenAnalysisRegions, streaming: false },
  ["/api/agent/screen-analysis/ocr" /* screenAnalysisOcr */]: { handler: handleScreenAnalysisOcr, streaming: false },
  ["/api/agent/screen-analysis/interruption" /* screenAnalysisInterruption */]: { handler: handleScreenAnalysisInterruption, streaming: false },
  ["/api/agent/desktop-automation" /* desktopAutomation */]: { handler: handleDesktopAutomation, streaming: true },
  ["/api/agent/desktop-automation/tools" /* desktopAutomationTools */]: { handler: handleDesktopAutomationTools, streaming: true },
  ["/api/agent/run-command" /* runCommand */]: { handler: handleRunCommand, streaming: false, requiresProvider: false },
  ["/api/agent/task-decomposer" /* taskDecomposer */]: { handler: handleTaskDecomposer, streaming: true },
  ["/api/agent/task-verifier" /* taskVerifier */]: { handler: handleTaskVerifier, streaming: true },
  ["/api/agent/doc-agent" /* docAgent */]: { handler: handleDocAgent, streaming: true },
  ["/api/agent/web-agent" /* webAgent */]: { handler: handleWebAgent, streaming: true },
  ["/api/agent/code-agent" /* codeAgent */]: { handler: handleCodeAgent, streaming: true },
  ["/api/agent/free-agent" /* freeAgent */]: { handler: handleFreeAgent, streaming: true }
};
async function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const buf = Buffer.concat(chunks);
        console.log(`[parseBody] raw=${buf.length}B utf8="${buf.toString("utf-8").slice(0, 150)}"`);
        let body;
        try {
          body = buf.toString("utf-8");
          resolve(JSON.parse(body));
        } catch {
          body = new TextDecoder("gbk").decode(buf);
          console.log(`[parseBody] UTF-8 parse failed, GBK retry="${body.slice(0, 150)}"`);
          resolve(JSON.parse(body));
        }
      } catch (e) {
        reject(new Error(`Invalid JSON body: ${e}`));
      }
    });
    req.on("error", reject);
  });
}
function sendJson(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}
function sendSSE(res) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    "Connection": "keep-alive"
  });
}
function sendSSEEvent(res, event) {
  res.write(`data: ${JSON.stringify(event)}

`);
}
async function handleRequest(req, res) {
  const url = req.url ?? "";
  const method = req.method?.toUpperCase() ?? "";
  if (method !== "POST") return false;
  const route = routes[url];
  if (!route) return false;
  try {
    const body = await parseBody(req);
    const { provider, apiKey, params } = body;
    if (route.requiresProvider !== false && (!provider || !apiKey)) {
      sendJson(res, 400, { ok: false, error: "Missing provider or apiKey" });
      return true;
    }
    if (route.streaming) {
      sendSSE(res);
      try {
        const stream = route.handler(provider, apiKey, params);
        for await (const chunk of stream) {
          if (chunk.startsWith("__TOOLS__:")) {
            try {
              const tools = JSON.parse(chunk.substring(10));
              sendSSEEvent(res, { type: "tools", content: tools });
            } catch {
              sendSSEEvent(res, { type: "text", content: chunk });
            }
          } else if (chunk.startsWith("__ERROR__:")) {
            sendSSEEvent(res, { type: "error", content: chunk.substring(10) });
          } else if (chunk.startsWith("__REASONING__:")) {
            sendSSEEvent(res, { type: "reasoning", content: chunk.substring(14) });
          } else {
            sendSSEEvent(res, { type: "text", content: chunk });
          }
        }
        sendSSEEvent(res, { type: "done" });
      } catch (e) {
        sendSSEEvent(res, { type: "error", content: String(e) });
        sendSSEEvent(res, { type: "done" });
      }
      res.end();
    } else {
      try {
        const data = await route.handler(provider, apiKey, params);
        sendJson(res, 200, { ok: true, data });
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e) });
      }
    }
  } catch (e) {
    sendJson(res, 400, { ok: false, error: String(e) });
  }
  return true;
}

// src/backend/server-entry.ts
var PORT = Number(process.env.BACKEND_PORT) || 5174;
var server = (0, import_node_http.createServer)(async (req, res) => {
  try {
    const handled = await handleRequest(req, res);
    if (!handled) {
      res.writeHead(404);
      res.end("Not Found");
    }
  } catch (e) {
    console.error("[backend] error:", e);
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal Server Error");
    }
  }
});
server.listen(PORT, () => {
  console.log(`[backend] http://localhost:${PORT}`);
});
