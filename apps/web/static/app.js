let token = localStorage.getItem('dap_token') || '';
let currentUser = null;
let agents = [];
let datasets = [];
let metrics = [];
let activePage = 'dashboard';
let currentTrace = null;
let lastAnalysisTaskId = '';

async function api(path, opts={}){
  const headers = Object.assign({'Content-Type':'application/json'}, opts.headers || {});
  if(opts.body instanceof FormData){ delete headers['Content-Type']; }
  if(token) headers['Authorization']='Bearer '+token;
  const res = await fetch(path, Object.assign({}, opts, {headers}));
  if(!res.ok){
    let msg = await res.text();
    try{ const j=JSON.parse(msg); msg = j.detail || j.error || msg; }catch(e){}
    throw new Error(msg);
  }
  const ct = res.headers.get('content-type') || '';
  return ct.includes('application/json') ? res.json() : res.text();
}
function esc(s){return String(s ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function fmt(v){ if(typeof v==='number') return Number.isInteger(v)?v:Math.round(v*100)/100; return v ?? ''; }
function short(s,n=90){s=String(s??''); return s.length>n?s.slice(0,n)+'…':s}
function tag(text, cls=''){return `<span class="tag ${cls}">${esc(text)}</span>`}
function toast(msg){const t=document.getElementById('toast');t.innerText=msg;t.classList.remove('hidden');setTimeout(()=>t.classList.add('hidden'),2600)}
function card(title, body, cls=''){return `<div class="card ${cls}"><h3>${esc(title)}</h3>${body}</div>`}
function renderTable(rows, limit=80){
  if(!rows || !rows.length) return '<div class="muted">暂无数据</div>';
  const cols = Object.keys(rows[0]);
  return `<div class="table-wrap"><table class="table"><thead><tr>${cols.map(c=>`<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${rows.slice(0,limit).map(r=>`<tr>${cols.map(c=>`<td>${esc(typeof r[c]==='object'?JSON.stringify(r[c]):fmt(r[c]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function renderChart(chart){
  const spec = chart.spec || {}; const data = spec.data || chart.data || [];
  const x = spec.x || chart.x || Object.keys(data[0]||{})[0]; const y = spec.y || chart.y || Object.keys(data[0]||{})[1];
  if(!data.length || !x || !y) return `<div class="chart"><b>${esc(chart.title||'图表')}</b><div class="muted">暂无数据</div></div>`;
  const max = Math.max(1, ...data.map(r=>Number(r[y]||0)));
  return `<div class="chart"><b>${esc(chart.title||'图表')}</b>${data.map(r=>{
    const val=Number(r[y]||0); const width=Math.max(2, Math.round(val/max*100));
    return `<div class="bar-row"><div class="muted">${esc(r[x])}</div><div><div class="bar" style="width:${width}%"></div></div><div>${fmt(val)}</div></div>`
  }).join('')}</div>`;
}
function agentOptions(type){return agents.filter(a=>!type || a.type===type).map(a=>`<option value="${a.id}">${esc(a.name)}</option>`).join('')}
function datasetOptions(){return datasets.map(d=>`<option value="${d.id}">${esc(d.name)}</option>`).join('')}
function setActiveNav(page){document.querySelectorAll('#nav button').forEach(b=>b.classList.toggle('active', b.dataset.page===page)); const titles={dashboard:'总览',agents:'Agent Studio',chat:'智能问数',analysis:'深度研究',panels:'分析面板',dataops:'数据能力',semantic:'语义中心',codex:'Codex 运行台',reports:'报告中心',knowledge:'知识库',evals:'评测中心',audit:'审计日志'}; document.getElementById('pageTitle').innerText=titles[page]||page;}
async function refreshCatalog(){agents = await api('/api/agents'); datasets = await api('/api/datasets').catch(()=>[]); metrics = await api('/api/metrics').catch(()=>[]);}

async function login(){
  try{
    const data=await api('/api/auth/login',{method:'POST',body:JSON.stringify({username:username.value,password:password.value})});
    token=data.token; currentUser=data.user; localStorage.setItem('dap_token',token);
    document.getElementById('login').classList.add('hidden'); document.getElementById('app').classList.remove('hidden');
    document.getElementById('currentUser').innerText=`${currentUser.name} / ${(currentUser.roles||[]).join(',')}`;
    await bootstrap();
  }catch(e){toast('登录失败：'+e.message)}
}
function logout(){localStorage.removeItem('dap_token'); location.reload();}
async function autoLogin(){
  if(!token) return;
  try{currentUser=await api('/api/auth/me');document.getElementById('login').classList.add('hidden');document.getElementById('app').classList.remove('hidden');document.getElementById('currentUser').innerText=`${currentUser.name} / ${(currentUser.roles||[]).join(',')}`;await bootstrap();}catch(e){localStorage.removeItem('dap_token')}
}
async function bootstrap(){await refreshCatalog(); showPage('dashboard');}
function showPage(name){
  activePage=name; setActiveNav(name);
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  document.getElementById('page-'+name).classList.remove('hidden');
  const renderers={dashboard:renderDashboard,agents:renderAgents,chat:renderChat,analysis:renderAnalysis,panels:renderPanels,dataops:renderDataOps,semantic:renderSemantic,codex:renderCodex,reports:renderReports,knowledge:renderKnowledge,evals:renderEvals,audit:renderAudit};
  renderers[name] && renderers[name]();
}
function globalJump(){const q=(document.getElementById('globalSearch').value||'').trim(); if(!q){showPage('chat');return} showPage('chat'); setTimeout(()=>{document.getElementById('chatInput').value=q; sendChat();},50)}

async function renderDashboard(){
  const stats=await api('/api/admin/stats').catch(()=>({counts:{agents:agents.length,datasets:datasets.length,metrics:metrics.length}}));
  const counts=stats.counts||stats;
  const codexDiag=await api('/api/codex/diagnostics').catch(()=>({}));
  const p=document.getElementById('page-dashboard');
  p.innerHTML=`<h1>独立数据智能体工作台</h1>
  <div class="grid">${Object.entries(counts).slice(0,8).map(([k,v])=>`<div class="card"><div class="muted">${esc(k)}</div><div class="metric">${esc(v)}</div></div>`).join('')}</div>
  <div class="grid3" style="margin-top:14px">
    ${card('完整 Agent 套件', `<p>内置 ${agents.length} 个 Agent：总控路由、智能问数、工单归因、深度研究、风险识别、数据画像、数据质量、语义治理、面板生成、报告和 Codex 工程 Agent。</p><div>${tag('Agent Gateway')}${tag('Trace')}${tag('RBAC')}</div>`)}
    ${card('数据能力面板', `<p>内置数据目录、指标语义、查询模板、SQL Workbench、数据画像、数据业务规则、CSV 导入、分析面板和 SQL Guard。</p><div>${tag('SQL Guard','green')}${tag('DQM')}${tag('Semantic')}</div>`)}
    ${card('Codex 运行状态', `<p>CLI：${codexDiag.cli?.path?esc(codexDiag.cli.path):'未检测'} / SDK：${codexDiag.sdk?.module_found?'已检测':'未检测'} / 默认模式：${esc(codexDiag.mode_default||'-')}</p><div>${tag('mock')}${tag('http')}${tag('cli')}${tag('sdk')}</div>`)}
  </div>
  <div class="card" style="margin-top:14px"><h3>一键验证路径</h3><div class="stepper"><span>总控 Agent 提问</span><span>查看 SQL/Trace</span><span>打开分析面板</span><span>运行数据质量</span><span>创建 Codex 工程任务</span><span>审批并派发</span></div></div>
  <div class="grid2" style="margin-top:14px"><div class="card"><h3>推荐问题</h3>${['本月收入最高的渠道有哪些？','客户工单根因分布是什么？','当前经营风险最高的区域有哪些？','给我生成一个经营总览面板','帮我创建一个 Codex 任务，优化智能问数页面'].map(q=>`<button class="ghost" style="margin:4px" onclick="showPage('chat');setTimeout(()=>askPreset('${q.replace(/'/g,"\\'")}'),40)">${esc(q)}</button>`).join('')}</div><div class="card"><h3>Agent 编排链路</h3><div class="agent-flow"><div class="agent-node">用户问题</div><span class="arrow">→</span><div class="agent-node">总控路由</div><span class="arrow">→</span><div class="agent-node">数据/知识/报告/Codex</div><span class="arrow">→</span><div class="agent-node">Trace + 审计</div></div></div></div>`;
}

async function renderAgents(){
  const groups={}; agents.forEach(a=>{groups[a.type]=groups[a.type]||[];groups[a.type].push(a)});
  document.getElementById('page-agents').innerHTML=`<h1>Agent Studio</h1><div class="toolbar">${tag('内置 '+agents.length+' 个 Agent','green')}${tag('可接 Dify / SuperSonic / DB-GPT / RAGFlow')}${tag('Codex CLI / SDK')}</div>${Object.entries(groups).map(([type,list])=>`<h2>${esc(type)}</h2><div class="grid3">${list.map(a=>`<div class="card"><h3>${esc(a.name)}</h3><p>${esc(a.description)}</p><div>${tag(a.type)}${tag(a.status,'green')}${tag(a.risk_level,a.risk_level==='high'?'amber':'')}</div><div class="muted" style="margin:10px 0">Adapter：${esc(a.adapter_id||'-')} / 版本：${esc(a.version||'-')}</div><button class="secondary" onclick="showPage('chat');setTimeout(()=>{document.getElementById('chatAgent').value='${a.id}'},60)">试用</button><button class="ghost" onclick="openAgentDetail('${a.id}')">详情</button></div>`).join('')}</div>`).join('')}<div id="agentDetail"></div>`;
}
async function openAgentDetail(id){
  const a=await api('/api/agents/'+id); document.getElementById('agentDetail').innerHTML=`<div class="card" style="margin-top:14px"><h3>${esc(a.name)} / 详情</h3><div class="grid2"><div>${renderTable(a.versions||[])}</div><div><h4>知识绑定</h4>${renderTable(a.knowledge_bindings||[])}</div></div></div>`; window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});
}

function renderChat(){
  document.getElementById('page-chat').innerHTML=`<div class="layout-3"><div class="pane"><h2>智能问数</h2><label>Agent</label><select id="chatAgent">${agentOptions()}</select><h3>推荐问题</h3>${['本月收入最高的渠道有哪些？','按区域统计本月收入','近三个月收入趋势如何？','客户工单根因分布是什么？','当前经营风险最高的区域有哪些？','运行订单数据质量规则','解释收入指标口径','帮我创建一个 Codex 任务，开发面板导出功能'].map(q=>`<button class="ghost" style="width:100%;margin:5px 0" onclick="askPreset('${q.replace(/'/g,"\\'")}')">${esc(q)}</button>`).join('')}</div><div class="pane"><div id="chatMessages"><div class="message assistant">选择“数据智能体总控 Agent”后可自动路由到问数、工单归因、异常识别、面板、语义、数据质量或 Codex。</div></div><div class="chat-input"><input id="chatInput" placeholder="输入业务问题，或输入开发需求让 Codex Agent 生成任务" onkeydown="if(event.key==='Enter')sendChat()"/><button onclick="sendChat()">发送</button></div></div><div class="pane"><h2>Trace 证据链</h2><div id="traceBox" class="muted">暂无 Trace</div></div></div>`;
  const router=agents.find(a=>a.id==='agent_router'); if(router) document.getElementById('chatAgent').value=router.id;
}
function askPreset(q){document.getElementById('chatInput').value=q;sendChat()}
async function sendChat(){
  const input=document.getElementById('chatInput'); const msg=input.value.trim(); if(!msg) return; const agent_id=document.getElementById('chatAgent').value;
  const box=document.getElementById('chatMessages'); box.innerHTML+=`<div class="message user">${esc(msg)}</div>`; input.value='';
  try{
    const data=await api('/api/chat/query',{method:'POST',body:JSON.stringify({message:msg,agent_id})}); const r=data.result||{};
    box.innerHTML+=`<div class="message assistant"><b>${esc(r.answer||'已返回结果')}</b>${r.report_markdown?`<div class="report">${esc(r.report_markdown)}</div>`:''}${r.codex_task?`<div class="code">Codex Task: ${esc(r.codex_task.id)} / ${esc(r.codex_task.status)} / ${esc(r.codex_task.mode)}</div>`:''}${(r.warnings||[]).map(w=>`<div class="status-warn">${esc(w)}</div>`).join('')}${(r.tables||[]).map(t=>`<h4>${esc(t.name||'表格')}</h4>${renderTable(t.rows||[])}`).join('')}${(r.charts||[]).map(renderChart).join('')}${(r.next_actions||[]).length?`<div class="stepper">${r.next_actions.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:''}</div>`;
    await loadTrace(data.trace_id);
  }catch(e){box.innerHTML+=`<div class="message assistant"><span class="status-failed">${esc(e.message)}</span></div>`}
  box.scrollTop=box.scrollHeight;
}
async function loadTrace(traceId){
  const trace=await api('/api/traces/'+traceId); currentTrace=trace; const output=trace.output||{};
  const steps=trace.steps||[], sql=trace.sql_runs||[], tools=trace.tool_calls||[];
  document.getElementById('traceBox').innerHTML=`<div>${tag(trace.status,trace.status==='success'?'green':'red')}${tag(trace.agent_id||'-')}${tag(trace.agent_version||'-')}</div><h3>输入</h3><div>${esc(trace.input)}</div><h3>输出</h3><div class="muted">${esc(output.answer_type||'-')}</div><h3>SQL</h3>${sql.length?sql.map(s=>`<div class="code">${esc(s.sql_text)}</div><div class="muted">${esc(s.status)} / ${s.row_count} 行 / ${s.duration_ms}ms</div>`).join(''):'<div class="muted">无 SQL</div>'}<h3>工具调用</h3>${tools.length?tools.map(t=>`<div class="card mini"><b>${esc(t.adapter_id)}</b><div class="muted">${esc(t.status)} / ${t.duration_ms}ms</div></div>`).join(''):'<div class="muted">无工具调用</div>'}<h3>步骤</h3>${steps.map(st=>`<div class="card mini"><b>${st.step_no}. ${esc(st.name)}</b><div class="muted">${esc(st.step_type)} / ${esc(st.status)}</div><pre class="code">${esc(JSON.stringify(st.output_json,null,2))}</pre></div>`).join('')}`;
}

function renderAnalysis(){
  document.getElementById('page-analysis').innerHTML=`<h1>深度研究</h1><div class="split"><div class="card"><h3>创建研究任务</h3><label>Agent</label><select id="analysisAgent">${agentOptions('analysis')}</select><label>研究问题</label><textarea id="analysisQuestion">分析本月收入变化的主要原因，并结合客户工单根因给出经营建议。</textarea><button onclick="runAnalysis()">创建任务</button><button class="secondary" onclick="approveLastTask()">审批上一个待审批任务</button><div id="analysisResult"></div></div><div class="card"><h3>深度研究设计</h3><div class="stepper"><span>分析计划</span><span>SQL 查询</span><span>工单补充</span><span>数据质量</span><span>报告草稿</span><span>人工复核</span></div><p class="muted">高风险研究默认进入 awaiting_approval，避免报告和建议直接进入执行链路。</p></div></div>`;
}
async function runAnalysis(){
  try{const r=await api('/api/analysis/tasks',{method:'POST',body:JSON.stringify({question:analysisQuestion.value,agent_id:analysisAgent.value,require_plan_approval:true})}); lastAnalysisTaskId=r.task_id||r.id; document.getElementById('analysisResult').innerHTML=`<div class="message assistant">任务：${esc(lastAnalysisTaskId)} / 状态：${esc(r.status)}</div><pre class="code">${esc(JSON.stringify(r,null,2))}</pre>`;}catch(e){toast(e.message)}
}
async function approveLastTask(){if(!lastAnalysisTaskId)return toast('暂无任务'); const r=await api(`/api/analysis/tasks/${lastAnalysisTaskId}/approve-plan`,{method:'POST',body:JSON.stringify({comment:'页面审批'})}); document.getElementById('analysisResult').innerHTML=`<div class="message assistant">已审批并执行：${esc(lastAnalysisTaskId)}</div><pre class="code">${esc(JSON.stringify(r,null,2))}</pre>`; if(r.trace_id) loadTrace(r.trace_id).catch(()=>{});}

async function renderPanels(){
  const panels=await api('/api/data/panels').catch(()=>[]); const pid=panels[0]?.id||'panel_business_overview';
  let panel=await api('/api/data/panels/'+pid).catch(()=>null);
  document.getElementById('page-panels').innerHTML=`<h1>分析面板</h1><div class="toolbar"><select id="panelSelect">${panels.map(p=>`<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select><button onclick="renderPanelDetail()">打开</button><button class="secondary" onclick="showPage('chat');setTimeout(()=>askPreset('给我生成一个经营总览面板'),50)">让 Agent 生成</button></div><div id="panelDetail">${panel?panelHtml(panel):'<div class="muted">暂无面板</div>'}</div>`;
  if(panel) document.getElementById('panelSelect').value=pid;
}
async function renderPanelDetail(){const panel=await api('/api/data/panels/'+document.getElementById('panelSelect').value); document.getElementById('panelDetail').innerHTML=panelHtml(panel)}
function panelHtml(panel){return `<div class="card"><h3>${esc(panel.name)}</h3><p class="muted">${esc(panel.description||'')}</p><div class="panel-grid">${(panel.widgets||[]).map(w=>`<div class="card widget"><h3>${esc(w.title)}</h3>${w.widget_type==='metric_card'?`<div class="metric">${esc((w.rows&&w.rows[0]&&Object.values(w.rows[0])[0])??'-')}</div>`:renderChart({title:w.title,spec:{data:w.rows||[],x:Object.keys((w.rows||[])[0]||{})[0],y:Object.keys((w.rows||[])[0]||{})[1]}})}<details><summary>SQL</summary><pre class="code">${esc(w.query_sql||'')}</pre></details></div>`).join('')}</div></div>`}

async function renderDataOps(){
  document.getElementById('page-dataops').innerHTML=`<h1>数据能力</h1><div class="tabs"><button class="active" onclick="dataTab('catalog',this)">数据目录</button><button onclick="dataTab('query',this)">SQL Workbench</button><button onclick="dataTab('profile',this)">数据画像</button><button onclick="dataTab('quality',this)">数据质量</button><button onclick="dataTab('import',this)">CSV 导入</button></div><div id="dataTab"></div>`;
  dataTab('catalog');
}
async function dataTab(name,btn){document.querySelectorAll('#page-dataops .tabs button').forEach(b=>b.classList.remove('active')); if(btn)btn.classList.add('active'); const box=document.getElementById('dataTab');
  if(name==='catalog'){box.innerHTML=`<div class="grid2"><div class="card"><h3>数据集</h3>${renderTable(datasets)}</div><div class="card"><h3>指标</h3>${renderTable(metrics)}</div></div>`;}
  if(name==='query'){box.innerHTML=`<div class="card"><h3>只读 SQL Workbench</h3><select id="qDataset">${datasetOptions()}</select><textarea id="qSql">SELECT channel, SUM(revenue) AS revenue FROM sales_orders GROUP BY channel ORDER BY revenue DESC LIMIT 10</textarea><button onclick="runSqlWorkbench()">执行</button><div id="sqlResult"></div></div>`;}
  if(name==='profile'){box.innerHTML=`<div class="card"><h3>数据画像</h3><select id="profileDataset">${datasetOptions()}</select><button onclick="runProfile()">生成画像</button><div id="profileResult"></div></div>`;}
  if(name==='quality'){const rules=await api('/api/data/quality-rules').catch(()=>[]);box.innerHTML=`<div class="card"><h3>数据业务规则</h3>${renderTable(rules)}<select id="qualityDataset"><option value="">全部数据集</option>${datasetOptions()}</select><button onclick="runQuality()">运行规则</button><div id="qualityResult"></div></div>`;}
  if(name==='import'){box.innerHTML=`<div class="card"><h3>CSV 导入</h3><div class="form-row"><input id="csvName" value="导入数据集"/><input id="csvDomain" value="Imported"/></div><input id="csvFile" type="file" accept=".csv"/><button onclick="importCsv()">上传</button><div id="importResult"></div></div>`;}
}
async function runSqlWorkbench(){try{const r=await api('/api/data/query',{method:'POST',body:JSON.stringify({dataset_id:qDataset.value,sql:qSql.value,max_rows:200})});document.getElementById('sqlResult').innerHTML=`${renderTable(r.rows||[])}<div class="muted">Trace: ${esc(r.trace_id)}</div>`; if(r.trace_id) loadTrace(r.trace_id).catch(()=>{});}catch(e){document.getElementById('sqlResult').innerHTML=`<div class="status-failed">${esc(e.message)}</div>`}}
async function runProfile(){const r=await api('/api/data/profile/'+profileDataset.value);document.getElementById('profileResult').innerHTML=`<div class="kpi-row"><div class="kpi"><div class="muted">数据集</div><b>${esc(r.dataset.name)}</b></div><div class="kpi"><div class="muted">行数</div><b>${r.row_count}</b></div><div class="kpi"><div class="muted">字段</div><b>${(r.fields||[]).length}</b></div></div><h3>字段画像</h3>${renderTable(r.fields||[])}<h3>样本</h3>${renderTable(r.sample_rows||[])}`}
async function runQuality(){const r=await api('/api/data/quality/run',{method:'POST',body:JSON.stringify({dataset_id:qualityDataset.value||null,rule_ids:[]})});document.getElementById('qualityResult').innerHTML=`<div class="muted">Trace: ${esc(r.trace_id)}</div>${renderTable((r.results||[]).map(x=>({rule:x.rule.name,dataset:x.dataset.name,status:x.status,checked_rows:x.checked_rows,failed_rows:x.failed_rows,severity:x.rule.severity})))}`; if(r.trace_id) loadTrace(r.trace_id).catch(()=>{});}
async function importCsv(){const fd=new FormData();fd.append('file',csvFile.files[0]); const url=`/api/data/import/csv?dataset_name=${encodeURIComponent(csvName.value)}&business_domain=${encodeURIComponent(csvDomain.value)}`; const r=await api(url,{method:'POST',body:fd,headers:{}});document.getElementById('importResult').innerHTML=`<pre class="code">${esc(JSON.stringify(r,null,2))}</pre>`; await refreshCatalog();}

async function renderSemantic(){
  const [terms,templates,cov]=await Promise.all([api('/api/semantic/terms').catch(()=>[]),api('/api/semantic/query-templates').catch(()=>[]),api('/api/semantic/coverage').catch(()=>({}))]);
  document.getElementById('page-semantic').innerHTML=`<h1>语义中心</h1><div class="grid4"><div class="card"><div class="muted">数据集</div><div class="metric">${cov.dataset_count??'-'}</div></div><div class="card"><div class="muted">指标</div><div class="metric">${cov.metric_count??'-'}</div></div><div class="card"><div class="muted">术语</div><div class="metric">${cov.term_count??'-'}</div></div><div class="card"><div class="muted">指标覆盖率</div><div class="metric">${Math.round((cov.metric_term_coverage||0)*100)}%</div></div></div><div class="grid2" style="margin-top:14px"><div class="card"><h3>业务术语</h3>${renderTable(terms)}</div><div class="card"><h3>查询模板</h3>${renderTable(templates)}</div></div>`;
}

async function renderCodex(){
  const [diag,tasks,workspaces]=await Promise.all([api('/api/codex/diagnostics').catch(()=>({})),api('/api/codex/tasks').catch(()=>[]),api('/api/codex/workspaces').catch(()=>[])]);
  document.getElementById('page-codex').innerHTML=`<h1>Codex 运行台</h1><div class="grid3"><div class="card"><h3>CLI</h3><p>enabled：${esc(diag.cli?.enabled)}<br/>path：${esc(diag.cli?.path||'未检测')}<br/>version：${esc(diag.cli?.version||'-')}</p></div><div class="card"><h3>SDK</h3><p>enabled：${esc(diag.sdk?.enabled)}<br/>module：${esc(diag.sdk?.python_module||'-')}<br/>found：${esc(diag.sdk?.module_found)}</p></div><div class="card"><h3>HTTP</h3><p>endpoint：${diag.http?.endpoint_configured?'已配置':'未配置'}<br/>default mode：${esc(diag.mode_default||'-')}</p></div></div><div class="split" style="margin-top:14px"><div class="card"><h3>创建 Codex 工程任务</h3><label>Workspace</label><select id="codexWs">${workspaces.map(w=>`<option value="${w.id}">${esc(w.name)}</option>`).join('')}</select><label>标题</label><input id="codexTitle" value="完善 独立数据智能体平台界面和功能"/><label>任务</label><textarea id="codexPrompt">进一步优化前端交互、完善数据能力面板、保持 Trace、权限和 SQL Guard 不退化，并补充测试。</textarea><label>模式</label><select id="codexMode"><option value="mock">mock</option><option value="http">http</option><option value="cli">cli</option><option value="sdk">sdk</option></select><button onclick="createCodexTask()">创建任务</button><div id="codexResult"></div></div><div class="card"><h3>任务列表</h3>${renderTable(tasks.map(t=>({id:t.id,title:t.title,status:t.status,mode:t.mode,risk:t.risk_level,updated_at:t.updated_at})))}<div class="form-row" style="margin-top:10px"><input id="codexTaskId" placeholder="任务ID"/><select id="dispatchMode"><option value="mock">mock</option><option value="http">http</option><option value="cli">cli</option><option value="sdk">sdk</option></select></div><button onclick="approveCodexTask()">审批</button><button class="secondary" onclick="dispatchCodexTask()">派发</button><button class="ghost" onclick="loadCodexTask()">查看任务</button><div id="codexTaskDetail"></div></div></div>`;
}
async function createCodexTask(){try{const r=await api('/api/codex/tasks',{method:'POST',body:JSON.stringify({workspace_id:codexWs.value,title:codexTitle.value,task_prompt:codexPrompt.value,mode:codexMode.value,risk_level:'high',requires_approval:true,acceptance_criteria:['保持平台现有接口兼容','更新相关页面与测试','运行 smoke/security/full agent 测试']})});document.getElementById('codexResult').innerHTML=`<div class="message assistant">已创建：${esc(r.id)} / ${esc(r.status)}</div><pre class="code">${esc(r.task_prompt)}</pre>`;toast('Codex 任务已创建'); renderCodex();}catch(e){toast(e.message)}}
async function approveCodexTask(){const id=codexTaskId.value.trim(); if(!id)return toast('请输入任务ID'); const r=await api(`/api/codex/tasks/${id}/approve`,{method:'POST',body:JSON.stringify({comment:'页面审批'})});toast('已审批');document.getElementById('codexTaskDetail').innerHTML=`<pre class="code">${esc(JSON.stringify(r,null,2))}</pre>`;}
async function dispatchCodexTask(){const id=codexTaskId.value.trim(); if(!id)return toast('请输入任务ID'); const r=await api(`/api/codex/tasks/${id}/dispatch`,{method:'POST',body:JSON.stringify({mode:dispatchMode.value})});document.getElementById('codexTaskDetail').innerHTML=`<h3>派发结果</h3><pre class="code">${esc(JSON.stringify(r.result_json,null,2))}</pre><h3>事件</h3>${renderTable(r.events||[])}`;}
async function loadCodexTask(){const id=codexTaskId.value.trim(); if(!id)return toast('请输入任务ID'); const r=await api('/api/codex/tasks/'+id); const h=await api(`/api/codex/tasks/${id}/handoff`).catch(()=>({handoff:''})); document.getElementById('codexTaskDetail').innerHTML=`<h3>${esc(r.title)}</h3><div>${tag(r.status)}${tag(r.mode)}${tag(r.risk_level,'amber')}</div><h3>Handoff</h3><pre class="code">${esc(h.handoff||r.task_prompt||'')}</pre><h3>事件</h3>${renderTable(r.events||[])}<h3>产物</h3>${renderTable(r.artifacts||[])}`;}

async function renderReports(){const reports=await api('/api/reports').catch(()=>[]);document.getElementById('page-reports').innerHTML=`<h1>报告中心</h1><div class="card">${renderTable(reports)}<div class="muted">报告支持 draft / pending_review / approved / published 状态流。</div></div>`;}
async function renderKnowledge(){const kbs=await api('/api/knowledge-bases').catch(()=>[]);document.getElementById('page-knowledge').innerHTML=`<h1>知识库</h1><div class="card"><p>平台管理知识库注册、绑定、版本与引用权限；真实知识内容可接 RAGFlow / Dify Knowledge。</p>${renderTable(kbs)}</div>`;}
async function renderEvals(){const sets=await api('/api/eval-sets').catch(()=>[]);document.getElementById('page-evals').innerHTML=`<h1>评测中心</h1><div class="card"><h3>评测集</h3>${renderTable(sets)}<div class="form-row" style="margin-top:12px"><select id="evalSet">${sets.map(s=>`<option value="${s.id}">${esc(s.name)}</option>`).join('')}</select><select id="evalAgent">${agentOptions()}</select></div><button onclick="runEval()">运行评测</button><div id="evalResult"></div></div>`;}
async function runEval(){const run=await api('/api/eval-runs',{method:'POST',body:JSON.stringify({eval_set_id:evalSet.value,agent_id:evalAgent.value})});document.getElementById('evalResult').innerHTML=`<h3>评测结果</h3>${renderTable(run.results||[])}`;}
async function renderAudit(){const logs=await api('/api/admin/audit-logs').catch(()=>[]);document.getElementById('page-audit').innerHTML=`<h1>审计日志</h1><div class="card">${renderTable(logs)}</div>`;}

autoLogin();
