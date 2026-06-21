const p={metadata:{id:"example_utils",name:"Example Utilities",version:"1.0.0",description:"Example plugin with string and data utilities",author:"OpenPaw Team",category:"utility",nameCn:"示例工具集",descriptionCn:"包含字符串和数据处理工具的示例插件"},tools:[{name:"string_case_convert",description:"Convert string between different cases (camelCase, snake_case, kebab-case, PascalCase)",nameCn:"字符串大小写转换",descriptionCn:"在不同命名格式之间转换字符串（camelCase、snake_case、kebab-case、PascalCase）",parameters:{type:"object",properties:{input:{type:"string",description:"Input string to convert"},targetCase:{type:"string",enum:["camel","snake","kebab","pascal"],description:"Target case format"}},required:["input","targetCase"]},async execute(r){const{input:s,targetCase:a}=r,t=s.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[-_]/g," ").toLowerCase().split(/\s+/).filter(Boolean);let e;switch(a){case"camel":e=t.map((n,i)=>i===0?n:n.charAt(0).toUpperCase()+n.slice(1)).join("");break;case"snake":e=t.join("_");break;case"kebab":e=t.join("-");break;case"pascal":e=t.map(n=>n.charAt(0).toUpperCase()+n.slice(1)).join("");break;default:return{success:!1,message:`Unknown target case: ${a}`}}return{success:!0,message:`Converted to ${a}: ${e}`,data:{input:s,output:e,targetCase:a,words:t}}}},{name:"json_format",description:"Format, minify, or validate JSON string",nameCn:"JSON 格式化",descriptionCn:"格式化、压缩或验证 JSON 字符串",parameters:{type:"object",properties:{input:{type:"string",description:"JSON string to process"},action:{type:"string",enum:["prettify","minify","validate"],description:"Action to perform"},indent:{type:"number",description:"Indentation spaces for prettify (default: 2)"}},required:["input","action"]},async execute(r){const{input:s,action:a,indent:t=2}=r;try{const e=JSON.parse(s);switch(a){case"validate":return{success:!0,message:"JSON is valid",data:{valid:!0,type:Array.isArray(e)?"array":typeof e,keys:typeof e=="object"&&e!==null?Object.keys(e).length:void 0}};case"prettify":return{success:!0,message:"JSON formatted",data:{output:JSON.stringify(e,null,t)}};case"minify":return{success:!0,message:"JSON minified",data:{output:JSON.stringify(e),originalSize:s.length,minifiedSize:JSON.stringify(e).length}};default:return{success:!1,message:`Unknown action: ${a}`}}}catch(e){return{success:!1,message:`Invalid JSON: ${e}`,data:{valid:!1,error:String(e)}}}}},{name:"markdown_to_html",description:"Convert simple Markdown to HTML (supports headings, bold, italic, links, lists, code blocks)",nameCn:"Markdown 转 HTML",descriptionCn:"将简单 Markdown 转换为 HTML（支持标题、粗体、斜体、链接、列表、代码块）",parameters:{type:"object",properties:{markdown:{type:"string",description:"Markdown text to convert"},wrapInDocument:{type:"boolean",description:"If true, wrap in complete HTML document with styles"}},required:["markdown"]},async execute(r){const{markdown:s,wrapInDocument:a=!1}=r;let t=s.replace(/```(\w+)?\n([\s\S]*?)```/g,'<pre><code class="language-$1">$2</code></pre>').replace(/`([^`]+)`/g,"<code>$1</code>").replace(/^### (.+)$/gm,"<h3>$1</h3>").replace(/^## (.+)$/gm,"<h2>$1</h2>").replace(/^# (.+)$/gm,"<h1>$1</h1>").replace(/\*\*\*(.+?)\*\*\*/g,"<strong><em>$1</em></strong>").replace(/\*\*(.+?)\*\*/g,"<strong>$1</strong>").replace(/\*(.+?)\*/g,"<em>$1</em>").replace(/\[([^\]]+)\]\(([^)]+)\)/g,'<a href="$2">$1</a>').replace(/^\s*[-*]\s+(.+)$/gm,"<li>$1</li>").replace(/\n\n/g,"</p><p>").replace(/\n/g,"<br>");return t=t.replace(/(<li>[\s\S]*?<\/li>)/g,"<ul>$1</ul>"),t=t.replace(/<p><\/p>/g,""),a&&(t=`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Converted Markdown</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      max-width: 800px;
      margin: 0 auto;
      padding: 2rem;
      line-height: 1.6;
      color: #333;
    }
    h1, h2, h3 { margin-top: 1.5em; margin-bottom: 0.5em; }
    code {
      background: #f4f4f4;
      padding: 0.2em 0.4em;
      border-radius: 3px;
      font-size: 0.9em;
    }
    pre {
      background: #f4f4f4;
      padding: 1em;
      border-radius: 5px;
      overflow-x: auto;
    }
    pre code {
      background: none;
      padding: 0;
    }
    a { color: #0066cc; }
    ul { padding-left: 2em; }
    li { margin: 0.3em 0; }
  </style>
</head>
<body>
<p>${t}</p>
</body>
</html>`),{success:!0,message:"Markdown converted to HTML",data:{html:t,originalLength:s.length,convertedLength:t.length}}}},{name:"chain_tools_demo",description:"Demo: chain multiple tools together (read file -> process -> write result)",nameCn:"工具链演示",descriptionCn:"演示：将多个工具链接在一起（读取文件 -> 处理 -> 写入结果）",parameters:{type:"object",properties:{inputFile:{type:"string",description:"Input file path"},outputFile:{type:"string",description:"Output file path"},operation:{type:"string",enum:["uppercase","lowercase","reverse"],description:"Operation to perform on file content"}},required:["inputFile","outputFile","operation"]},async execute(r,s){const{inputFile:a,outputFile:t,operation:e}=r;s.log(`Processing ${a} -> ${t}`,"info");const n=await s.callTool("read_file",{file_path:a});if(!n.success)return{success:!1,message:`Failed to read input file: ${n.message}`};const i=n.data?.content||"";let o;switch(e){case"uppercase":o=i.toUpperCase();break;case"lowercase":o=i.toLowerCase();break;case"reverse":o=i.split("").reverse().join("");break;default:return{success:!1,message:`Unknown operation: ${e}`}}s.log(`Applied ${e} operation`,"info");const c=await s.callTool("write_file",{file_path:t,content:o});return c.success?{success:!0,message:`Processed ${a} -> ${t} using ${e}`,data:{input:a,output:t,operation:e,inputSize:i.length,outputSize:o.length}}:{success:!1,message:`Failed to write output file: ${c.message}`}}}],async onInit(r){r.log("Example Utils plugin initialized","info")},async onDispose(){console.log("[ExamplePlugin] Disposed")}};export{p as default};
