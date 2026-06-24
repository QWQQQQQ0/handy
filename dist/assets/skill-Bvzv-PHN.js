function s(e){const n=e.returns?`${e.description}

Return value: ${e.returns}`:e.description;return{type:"function",function:{name:e.name,description:n,parameters:e.parameters}}}function r(e,n,t){return{success:e,message:n,data:t}}const a=(e,n)=>r(!0,e,n),i=(e,n)=>r(!1,e,n);export{i as S,a,s as t};
