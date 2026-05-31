let token = localStorage.getItem('dap_token') || '';
let currentUser = null;
let agents = [];
let datasets = [];
let metrics = [];
let dataCatalogFilterState = {q:'', domain:'all', classification:'all', refresh:'all'};
let activeDatasetId = '';
let activePage = 'dashboard';
let currentTrace = null;
let lastAnalysisTaskId = '';
let lastSidebarTrigger = null;
let chatSending = false;
let chatAbortController = null;
let chatSessions = [];
let chatSessionFilter = {status:'active', q:''};
let sessionSearchCache = {};
let answerDraftCache = {};
let activeSessionId = '';
let activeChatMessages = [];
let chatCanvasDraft = '';
let chatCanvasVersions = [];
let chatCanvasVersionIndex = -1;
let chatCanvasLastSelection = {start:0,end:0,text:''};
let chatCanvasDiffVisible = false;
let commandItems = [];
let commandIndex = 0;
let composerCommandIndex = 0;
let pendingEvidenceTarget = '';
let knowledgeBasesCache = [];
let knowledgeVersionCache = {};
let knowledgeFilterState = {q:'', backend:'all', type:'all'};
let activeKnowledgeBaseId = '';
let auditLogsCache = [];
let activeAgentDetailId = '';
let agentFilterState = {q:'', type:'all', risk:'all'};
let panelCatalogCache = [];
let activePanelId = '';
let evalSetsCache = [];
let evalCaseCache = {};
let activeEvalSetId = '';
let evalFilterState = {q:'', domain:'all', tag:'all'};
let semanticFilterState = {q:'', domain:''};
let reportsCache = [];
let reportFilterState = {q:'', status:'all', type:'all'};
let activeReportId = '';
let commandAssetsLoaded = false;
let contextPackAssetFilterState = {q:'', type:'all'};
const CONTEXT_PACK_STORAGE_KEY = 'dap_context_pack_v1';
const CONTEXT_PACK_PRESETS_STORAGE_KEY = 'dap_context_pack_presets_v1';
let contextPack = loadContextPack();
let contextPackPresets = loadContextPackPresets();
let activeContextPackPresetId = '';

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
function setBusy(el,busy=true){
  if(!el) return;
  el.disabled=busy;
  el.classList.toggle('is-busy',busy);
}
function inlineLoading(text='正在处理'){
  return `<div class="inline-loading" role="status" aria-live="polite"><span></span>${esc(text)}</div>`;
}
function stateBanner(kind='info', title='状态更新', text='', meta=[]){
  const icon={success:'OK',warn:'!',error:'!',pending:'...',info:'i'}[kind]||'i';
  const role=kind==='error'?'alert':'status';
  return `<div class="state-banner ${kind}" role="${role}" aria-live="polite"><span class="state-icon">${esc(icon)}</span><div><b>${esc(title)}</b>${text?`<p>${esc(text)}</p>`:''}${meta.length?`<div class="state-meta">${meta.map(m=>tag(m)).join('')}</div>`:''}</div></div>`;
}
const keyLabels={
  id:'ID',name:'名称',title:'标题',description:'说明',status:'状态',type:'类型',mode:'模式',risk:'风险',risk_level:'风险',
  updated_at:'更新时间',created_at:'创建时间',dataset_id:'数据集',dataset_name:'数据集',business_domain:'业务域',
  source_id:'数据源',physical_table:'物理表',refresh_mode:'刷新',data_classification:'分级',code:'编码',formula:'口径公式',
  time_grain:'时间粒度',owner_id:'负责人',checked_rows:'检查行数',failed_rows:'异常行数',severity:'级别',
  rule:'规则',agent_id:'Agent',adapter_id:'Adapter',duration_ms:'耗时',row_count:'行数',trace_id:'Trace',
  agents:'Agent',sessions:'会话',tasks:'任务',traces:'Trace',reports:'报告',eval_sets:'评测集',feedback:'反馈',audit_logs:'审计',
  query_result:'查询结果',region:'区域',revenue:'收入',order_count:'订单数',gross_margin:'毛利',
  actor:'操作者',user_id:'用户',action:'动作',resource_type:'资源类型',resource_id:'资源 ID',object_type:'对象类型',object_id:'对象 ID',
  request_id:'Request ID',ip:'IP',version:'版本',backend_type:'后端',question:'问题',score:'得分',error_type:'错误类型',
  term:'术语',term_type:'术语类型',definition:'定义',canonical_object_type:'绑定对象',canonical_object_id:'对象 ID',synonyms:'同义词',
  intent:'意图',template_text:'模板问题',sql_template:'SQL 模板',chart_type:'图表类型',example_questions:'示例问题',
  field_count:'字段',field_desc_missing_count:'字段说明缺口',field_name:'字段名',display_name:'展示名',data_type:'数据类型',
  is_sensitive:'敏感',masking_policy:'脱敏策略',key:'配置键',value:'值',username:'用户名',department:'部门',
  failed_login_count:'失败登录',locked_until:'锁定至',last_login_at:'上次登录',permissions:'权限',
  expected_answer:'期望回答',expected_sql:'期望 SQL',expected_report_outline:'报告大纲',tags:'标签',widget_type:'Widget',
  metric_id:'指标',query_sql:'SQL',eval_set_id:'评测集',agent_version:'Agent 版本',started_at:'开始时间',finished_at:'结束时间'
};
const valueLabels={
  active:'启用',published:'已发布',success:'成功',failed:'失败',error:'错误',pending:'待处理',pending_review:'待复核',
  approved:'已批准',awaiting_approval:'待审批',draft:'草稿',passed:'通过',high:'高风险',medium:'中风险',low:'低风险',
  confidential:'敏感',internal:'内部',public:'公开',daily:'每日',month:'月',mock:'mock',http:'HTTP',cli:'CLI',sdk:'SDK',
  router:'总控路由',chatbi:'智能问数',analysis:'深度研究',knowledge:'知识问答',report:'报告生成',risk:'风险识别',
  data:'数据治理',semantic:'语义治理',panel:'面板生成',codex:'工程派发',login:'登录',chat_query:'智能问数',
  metric:'指标',business_term:'业务术语',topn:'TopN',trend:'趋势',distribution:'分布',roi:'ROI',chat_answer:'问数报告',
  report_asset:'报告',session:'会话',
  page:'页面',agent:'Agent',dataset:'数据集',prompt:'问题',ask:'提问'
};
function displayKey(k){return keyLabels[k]||String(k||'').replace(/_/g,' ')}
function displayValue(v){return valueLabels[String(v)]||fmt(v)}
function statusClass(v){
  const s=String(v||'').toLowerCase();
  if(['success','active','published','approved','pass','passed','ok','completed','closed'].includes(s)) return 'green';
  if(['failed','error','rejected','high'].includes(s)) return 'red';
  if(['pending','pending_review','awaiting_approval','medium','confidential','warn'].includes(s)) return 'amber';
  return '';
}
function statusTag(v){return tag(displayValue(v), statusClass(v))}
function emptyState(title='暂无数据', text='当前筛选范围没有可展示记录。'){
  return `<div class="empty-state"><div class="empty-icon">∅</div><b>${esc(title)}</b><p>${esc(text)}</p></div>`;
}
function loadingState(title='正在加载工作台数据'){
  return `<div class="loading-panel" role="status" aria-live="polite"><div class="loading-bar"></div><b>${esc(title)}</b><p>正在读取权限范围内的数据、状态和 Trace 线索。</p></div>`;
}
function pageHeader(title, subtitle='', chips=[]){
  return `<div class="page-heading"><div><div class="eyebrow">DATA AGENT WORKSTATION</div><h1>${esc(title)}</h1>${subtitle?`<p>${esc(subtitle)}</p>`:''}</div>${chips.length?`<div class="heading-chips">${chips.map(c=>Array.isArray(c)?tag(c[0],c[1]):tag(c)).join('')}</div>`:''}</div>`;
}
function metricCard(label, value, note='', cls=''){
  return `<div class="metric-card ${cls}"><div class="metric-label">${esc(label)}</div><div class="metric">${esc(displayValue(value))}</div>${note?`<div class="muted">${esc(note)}</div>`:''}</div>`;
}
function jsArg(s){return String(s??'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/\r?\n/g,'\\n')}
function countBy(rows,key){
  return (rows||[]).reduce((acc,row)=>{const k=row?.[key]||'unknown'; acc[k]=(acc[k]||0)+1; return acc;},{});
}
function topCounts(rows,key,limit=5){
  return Object.entries(countBy(rows,key)).sort((a,b)=>b[1]-a[1]).slice(0,limit);
}
function timeText(v){return v?String(v).replace('T',' ').replace('Z',' UTC'):'-'}
function compactText(v){return String(v??'').replace(/\s+/g,' ').trim()}
function compactTags(values,limit=4){
  const list=[...new Set((values||[]).filter(Boolean))].slice(0,limit);
  return list.length?list.map(v=>tag(v)).join(''):'<span class="muted">暂无标签</span>';
}
function defaultContextPack(){
  return {name:'默认工作包',instructions:'',agentId:'',datasetIds:[],knowledgeBaseIds:[],reportIds:[],traceIds:[],sessionId:'',sessionIds:[],toolMode:'auto',evidenceDepth:'standard',memoryMode:'project',includeCanvas:false,updatedAt:''};
}
function normalizeIdList(list,limit=6){
  return [...new Set(asList(list).map(v=>String(v||'').trim()).filter(Boolean))].slice(0,limit);
}
function normalizeContextPack(pack={}){
  const base=defaultContextPack();
  const next=Object.assign({},base,pack||{});
  next.name=short(next.name||base.name,40);
  next.instructions=String(next.instructions||'').slice(0,1200);
  next.agentId=String(next.agentId||'').slice(0,80);
  next.datasetIds=normalizeIdList(next.datasetIds,6);
  next.knowledgeBaseIds=normalizeIdList(next.knowledgeBaseIds,6);
  next.reportIds=normalizeIdList(next.reportIds,4);
  next.traceIds=normalizeIdList(next.traceIds,6);
  next.sessionId=String(next.sessionId||'').slice(0,90);
  next.sessionIds=normalizeIdList([next.sessionId,...asList(next.sessionIds)],8);
  next.sessionId=String(next.sessionId||next.sessionIds[0]||'').slice(0,90);
  next.toolMode=['auto','analysis','sql','codex'].includes(next.toolMode)?next.toolMode:'auto';
  next.evidenceDepth=['standard','full'].includes(next.evidenceDepth)?next.evidenceDepth:'standard';
  next.memoryMode=['default','project'].includes(next.memoryMode)?next.memoryMode:'project';
  next.includeCanvas=Boolean(next.includeCanvas);
  next.updatedAt=String(next.updatedAt||'').slice(0,40);
  return next;
}
function loadContextPack(){
  try{
    const stored=localStorage.getItem(CONTEXT_PACK_STORAGE_KEY);
    return stored?normalizeContextPack(JSON.parse(stored)):defaultContextPack();
  }catch(e){
    return defaultContextPack();
  }
}
function contextPackPresetId(){
  return `pack_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;
}
function normalizeContextPackPreset(preset={}){
  const pack=normalizeContextPack(preset.pack||preset);
  const name=short(String(preset.name||pack.name||'工作包预设').trim()||'工作包预设',40);
  pack.name=name;
  return {
    id:String(preset.id||contextPackPresetId()).slice(0,80),
    name,
    pack,
    updatedAt:String(preset.updatedAt||pack.updatedAt||new Date().toISOString()).slice(0,40)
  };
}
function loadContextPackPresets(){
  try{
    const stored=localStorage.getItem(CONTEXT_PACK_PRESETS_STORAGE_KEY);
    const list=stored?JSON.parse(stored):[];
    return Array.isArray(list)?list.map(normalizeContextPackPreset).slice(0,12):[];
  }catch(e){
    return [];
  }
}
function persistContextPackPresets(){
  try{localStorage.setItem(CONTEXT_PACK_PRESETS_STORAGE_KEY,JSON.stringify(contextPackPresets));}catch(e){}
}
function contextPackHasContent(pack=contextPack){
  const p=normalizeContextPack(pack);
  return Boolean(p.instructions.trim()||p.agentId||p.datasetIds.length||p.knowledgeBaseIds.length||p.reportIds.length||p.traceIds.length||p.sessionIds.length||(p.includeCanvas&&chatCanvasValue().trim()));
}
function asList(value){
  if(Array.isArray(value)) return value;
  if(!value) return [];
  if(typeof value==='string'){
    try{ const parsed=JSON.parse(value); return Array.isArray(parsed)?parsed:[value]; }catch(e){ return value.split(',').map(x=>x.trim()).filter(Boolean); }
  }
  return [value];
}
function assetName(list,id,fallback='-'){
  if(!id) return fallback;
  const item=(list||[]).find(x=>x.id===id);
  return item?.name || item?.display_name || id;
}
function datasetName(id){return assetName(datasets,id,id||'-')}
function metricName(id){return assetName(metrics,id,id||'-')}
function knowledgeBaseName(id){return assetName(knowledgeBasesCache,id,id||'-')}
function cellHtml(key,value){
  if(value===null || value===undefined || value==='') return '<span class="muted">-</span>';
  if(['status','risk','risk_level','severity','mode','data_classification','refresh_mode'].includes(key)) return statusTag(value);
  if(key==='action') return tag(displayValue(value));
  if(typeof value==='boolean') return statusTag(value?'启用':'关闭');
  if(Array.isArray(value)) return compactTags(value,5);
  if(typeof value==='object') return `<details><summary>查看</summary><pre class="code">${esc(JSON.stringify(value,null,2))}</pre></details>`;
  const shown=displayValue(value);
  if(String(shown).length>72) return `<span title="${esc(shown)}">${esc(short(shown,72))}</span>`;
  return esc(shown);
}
function renderTable(rows, opts=80){
  const cfg=typeof opts==='number'?{limit:opts}:(opts||{});
  const limit=cfg.limit||80;
  if(!rows || !rows.length) return emptyState(cfg.emptyTitle||'暂无数据', cfg.emptyText||'当前没有可展示记录。');
  let cols=(cfg.columns&&cfg.columns.length?cfg.columns:Object.keys(rows[0])).filter(c=>rows.some(r=>Object.prototype.hasOwnProperty.call(r,c)));
  if(!cols.length) cols=Object.keys(rows[0]);
  const cls=cfg.compact?' table compact':' table';
  const visibleRows=rows.slice(0,limit);
  const meta=cfg.meta===false?'':`<div class="table-meta"><span>${visibleRows.length} / ${rows.length} rows</span><span>· ${cols.length} columns</span>${rows.length>limit?`<span>· 已截断到 ${limit} 行</span>`:''}</div>`;
  return `<div class="table-shell">${meta}<div class="table-wrap"><table class="${cls}"><thead><tr>${cols.map(c=>`<th>${esc((cfg.labels&&cfg.labels[c])||displayKey(c))}</th>`).join('')}</tr></thead><tbody>${visibleRows.map(r=>`<tr>${cols.map(c=>`<td>${cellHtml(c,r[c])}</td>`).join('')}</tr>`).join('')}</tbody></table></div></div>`;
}
function metricsForDataset(d){
  return metrics.filter(m=>m.dataset_id===d.id||m.dataset_name===d.name);
}
function datasetSearchText(d){
  const related=metricsForDataset(d);
  return [d.id,d.name,d.physical_table,d.business_domain,d.description,d.data_classification,d.refresh_mode,d.status,...related.flatMap(m=>[m.name,m.code,m.formula,m.status])].filter(Boolean).join(' ').toLowerCase();
}
function datasetMatches(d){
  const q=(dataCatalogFilterState.q||'').trim().toLowerCase();
  const domain=dataCatalogFilterState.domain||'all';
  const classification=dataCatalogFilterState.classification||'all';
  const refresh=dataCatalogFilterState.refresh||'all';
  return (domain==='all'||d.business_domain===domain) &&
    (classification==='all'||(d.data_classification||'internal')===classification) &&
    (refresh==='all'||(d.refresh_mode||'unknown')===refresh) &&
    (!q||datasetSearchText(d).includes(q));
}
function dataCatalogFilterOptions(key,items){
  return items.map(([value,label])=>`<option value="${esc(value)}" ${dataCatalogFilterState[key]===value?'selected':''}>${esc(label)}</option>`).join('');
}
function dataCatalogFilterBar(filtered=[]){
  const domains=[['all','全部业务域'],...[...new Set(datasets.map(d=>d.business_domain).filter(Boolean))].sort().map(v=>[v,v])];
  const classes=[['all','全部分级'],...[...new Set(datasets.map(d=>d.data_classification||'internal').filter(Boolean))].sort().map(v=>[v,displayValue(v)])];
  const refreshModes=[['all','全部刷新'],...[...new Set(datasets.map(d=>d.refresh_mode||'unknown').filter(Boolean))].sort().map(v=>[v,displayValue(v)])];
  return `<div class="data-catalog-filter">
    <label><span>搜索数据资产</span><input id="dataCatalogSearch" value="${esc(dataCatalogFilterState.q)}" placeholder="名称、表名、字段口径、指标" oninput="setDataCatalogFilter('q',this.value)" aria-label="搜索数据资产"/></label>
    <label><span>业务域</span><select id="dataCatalogDomainFilter" onchange="setDataCatalogFilter('domain',this.value)" aria-label="筛选业务域">${dataCatalogFilterOptions('domain',domains)}</select></label>
    <label><span>分级</span><select id="dataCatalogClassFilter" onchange="setDataCatalogFilter('classification',this.value)" aria-label="筛选数据分级">${dataCatalogFilterOptions('classification',classes)}</select></label>
    <label><span>刷新</span><select id="dataCatalogRefreshFilter" onchange="setDataCatalogFilter('refresh',this.value)" aria-label="筛选刷新模式">${dataCatalogFilterOptions('refresh',refreshModes)}</select></label>
    <button class="report-action" onclick="resetDataCatalogFilters()">重置</button>
    <small id="dataCatalogResultCount" class="asset-filter-count">显示 ${filtered.length} / ${datasets.length}</small>
  </div>`;
}
function datasetCard(d){
  const related=metricsForDataset(d);
  return `<div class="asset-card ${d.id===activeDatasetId?'active':''}" data-dataset-id="${esc(d.id)}"><div class="asset-card-head"><div><b>${esc(d.name)}</b><span>${esc(d.physical_table||d.id)}</span></div>${statusTag(d.status)}</div><p>${esc(d.description||'暂无说明')}</p><div>${tag(d.business_domain||'Domain')}${statusTag(d.data_classification)}${statusTag(d.refresh_mode)}${related.length?tag(`${related.length} metrics`,'green'):''}</div><div class="asset-actions"><button class="report-action" onclick="openDatasetDetail('${jsArg(d.id)}',this)">详情</button><button class="report-action" onclick="dataTab('query',document.querySelector('#page-dataops .tabs button[data-tab=&quot;query&quot;]'));setTimeout(()=>{document.getElementById('qDataset').value='${jsArg(d.id)}';syncWorkbenchSql()},60)">查询</button><button class="report-action" onclick="dataTab('profile',document.querySelector('#page-dataops .tabs button[data-tab=&quot;profile&quot;]'));setTimeout(()=>{document.getElementById('profileDataset').value='${jsArg(d.id)}'},60)">画像</button></div></div>`;
}
function promptButton(q){return `<button class="prompt-pill" onclick="askPreset('${jsArg(q)}')">${esc(q)}</button>`}
function percent(v){return Math.max(0,Math.min(100,Math.round(Number(v||0)*100)))}
function agentCard(a){
  return `<div class="agent-card">
    <div class="agent-card-head"><div><b>${esc(a.name)}</b><span>${esc(a.id)}</span></div>${statusTag(a.status)}</div>
    <p>${esc(a.description||'暂无说明')}</p>
    <div class="agent-tags">${tag(a.type||'agent')}${statusTag(a.risk_level||'low')}${a.adapter_id?tag(a.adapter_id):''}</div>
    <div class="agent-meta"><span>Version ${esc(a.version||'-')}</span><span>${esc(a.owner_id||'platform')}</span></div>
    <div class="agent-actions"><button class="secondary" onclick="showPage('chat');setTimeout(()=>{document.getElementById('chatAgent').value='${jsArg(a.id)}';syncChatContextBar()},60)">试用</button><button class="ghost" onclick="openAgentDetail('${jsArg(a.id)}')">详情</button></div>
  </div>`;
}
function agentMiniCard(a){
  return `<button class="agent-mini-card ${a.id===activeAgentDetailId?'active':''}" data-agent-id="${esc(a.id)}" onclick="openAgentDetail('${jsArg(a.id)}')">
    <span>${esc(displayValue(a.type||'agent'))}</span><b>${esc(a.name)}</b><p>${esc(short(a.description||a.id,88))}</p><div>${statusTag(a.status)}${statusTag(a.risk_level||'low')}${a.adapter_id?tag(a.adapter_id):''}</div>
  </button>`;
}
function agentMatches(a){
  const q=(agentFilterState.q||'').trim().toLowerCase();
  const type=agentFilterState.type||'all';
  const risk=agentFilterState.risk||'all';
  const haystack=[a.id,a.name,a.type,a.description,a.adapter_id,a.backend_type,a.risk_level,a.status].filter(Boolean).join(' ').toLowerCase();
  return (type==='all'||a.type===type) && (risk==='all'||(a.risk_level||'low')===risk) && (!q||haystack.includes(q));
}
function agentFilterOptions(key,items){
  return items.map(([value,label])=>`<option value="${esc(value)}" ${agentFilterState[key]===value?'selected':''}>${esc(label)}</option>`).join('');
}
function agentFilterBar(filtered=[]){
  const types=[['all','全部能力'],...[...new Set(agents.map(a=>a.type).filter(Boolean))].sort().map(t=>[t,displayValue(t)])];
  const risks=[['all','全部风险'],['low','低风险'],['medium','中风险'],['high','高风险']];
  return `<div class="agent-filter-bar">
    <label><span>搜索 Agent</span><input id="agentSearch" value="${esc(agentFilterState.q)}" placeholder="名称、ID、Adapter、描述" oninput="setAgentFilter('q',this.value)" aria-label="搜索 Agent"/></label>
    <label><span>能力类型</span><select id="agentTypeFilter" onchange="setAgentFilter('type',this.value)" aria-label="筛选 Agent 类型">${agentFilterOptions('type',types)}</select></label>
    <label><span>风险</span><select id="agentRiskFilter" onchange="setAgentFilter('risk',this.value)" aria-label="筛选 Agent 风险">${agentFilterOptions('risk',risks)}</select></label>
    <button class="report-action" onclick="resetAgentFilters()">重置</button>
    <small id="agentResultCount" class="agent-filter-count">显示 ${filtered.length} / ${agents.length}</small>
  </div>`;
}
function renderAgentDirectory(){
  const filtered=agents.filter(agentMatches);
  const groups={};
  filtered.forEach(a=>{groups[a.type]=groups[a.type]||[];groups[a.type].push(a)});
  const box=document.getElementById('agentDirectoryList');
  if(box) box.innerHTML=filtered.length?Object.entries(groups).map(([type,list])=>`<div class="agent-mini-section"><h3>${esc(displayValue(type))} <span>${list.length}</span></h3>${list.map(agentMiniCard).join('')}</div>`).join(''):emptyState('没有匹配 Agent','调整搜索、能力类型或风险筛选。');
  const count=document.getElementById('agentResultCount');
  if(count) count.innerText=`显示 ${filtered.length} / ${agents.length}`;
  if(activeAgentDetailId && !filtered.some(a=>a.id===activeAgentDetailId)){
    activeAgentDetailId=filtered[0]?.id||'';
    if(activeAgentDetailId) openAgentDetail(activeAgentDetailId).catch(()=>{});
  }
}
function setAgentFilter(key,value){
  agentFilterState[key]=value;
  renderAgentDirectory();
}
function resetAgentFilters(){
  agentFilterState={q:'',type:'all',risk:'all'};
  const q=document.getElementById('agentSearch');
  if(q) q.value='';
  const type=document.getElementById('agentTypeFilter');
  if(type) type.value='all';
  const risk=document.getElementById('agentRiskFilter');
  if(risk) risk.value='all';
  renderAgentDirectory();
}
function canAdminReports(){
  return (currentUser?.roles||[]).includes('admin');
}
function reportTypeLabel(type){
  return displayValue(type||'report');
}
function reportTypes(reports=[]){
  return [...new Set(reports.map(r=>r.report_type||'report').filter(Boolean))].sort();
}
function reportSearchText(r){
  return [r.title,r.id,r.report_type,r.status,r.owner_id,r.agent_id,r.created_at,r.updated_at].filter(Boolean).join(' ').toLowerCase();
}
function reportMatches(r){
  const q=(reportFilterState.q||'').trim().toLowerCase();
  const status=reportFilterState.status||'all';
  const type=reportFilterState.type||'all';
  return (status==='all'||(r.status||'draft')===status) && (type==='all'||(r.report_type||'report')===type) && (!q||reportSearchText(r).includes(q));
}
function reportFilterBar(reports=[]){
  const statusCounts=countBy(reports,'status');
  const statuses=[
    ['all','全部',reports.length],
    ['draft','草稿',statusCounts.draft||0],
    ['pending_review','待复核',statusCounts.pending_review||0],
    ['approved','已批准',statusCounts.approved||0],
    ['published','已发布',statusCounts.published||0]
  ];
  const types=reportTypes(reports);
  return `<div class="report-filter-bar">
    <label><span>搜索报告</span><input id="reportSearch" placeholder="标题、ID、类型、Owner" value="${esc(reportFilterState.q)}" oninput="setReportFilter('q',this.value)" aria-label="搜索报告"/></label>
    <div class="report-filter-group" role="tablist" aria-label="报告状态">${statuses.map(([value,label,count])=>`<button data-report-status="${esc(value)}" class="${reportFilterState.status===value?'active':''}" onclick="setReportFilter('status','${jsArg(value)}')">${esc(label)} <small>${esc(count)}</small></button>`).join('')}</div>
    <label><span>类型</span><select id="reportTypeFilter" onchange="setReportFilter('type',this.value)" aria-label="报告类型"><option value="all">全部类型</option>${types.map(t=>`<option value="${esc(t)}" ${reportFilterState.type===t?'selected':''}>${esc(reportTypeLabel(t))}</option>`).join('')}</select></label>
    <button class="report-action" onclick="resetReportFilters()">重置</button>
    <small id="reportAssetCount" class="report-filter-count"></small>
  </div>`;
}
function syncReportFilterControls(filtered=[]){
  document.querySelectorAll('[data-report-status]').forEach(btn=>btn.classList.toggle('active',btn.dataset.reportStatus===reportFilterState.status));
  const type=document.getElementById('reportTypeFilter');
  if(type && type.value!==reportFilterState.type) type.value=reportFilterState.type;
  const count=document.getElementById('reportAssetCount');
  if(count) count.innerText=`显示 ${filtered.length} / ${reportsCache.length}`;
}
function renderReportList(){
  const filtered=reportsCache.filter(reportMatches);
  const grid=document.getElementById('reportAssetGrid');
  if(grid) grid.innerHTML=filtered.length?filtered.map(reportCard).join(''):emptyState('没有匹配报告','调整搜索、状态或类型筛选后再试。');
  const table=document.getElementById('reportTablePanel');
  if(table) table.innerHTML=renderTable(filtered,{columns:['id','title','status','report_type','owner_id','created_at','updated_at'],limit:80});
  syncReportFilterControls(filtered);
}
function setReportFilter(key,value){
  reportFilterState[key]=value;
  renderReportList();
}
function resetReportFilters(){
  reportFilterState={q:'',status:'all',type:'all'};
  const q=document.getElementById('reportSearch');
  if(q) q.value='';
  renderReportList();
}
function reportCard(r){
  const flow=['draft','pending_review','approved','published'];
  const idx=Math.max(0,flow.indexOf(r.status||'draft'));
  return `<article class="report-card ${r.id===activeReportId?'active':''}">
    <div class="report-card-head"><div><span>${esc(reportTypeLabel(r.report_type))}</span><b>${esc(r.title||r.id)}</b></div>${statusTag(r.status||'draft')}</div>
    <div class="mini-flow">${flow.map((s,i)=>`<span class="${i<=idx?'done':''}">${esc(displayValue(s))}</span>`).join('')}</div>
    <div class="report-meta"><span>${esc(r.owner_id||'platform')}</span><span>${esc(timeText(r.updated_at||r.created_at))}</span></div>
    <div class="report-actions">${reportActionButtons(r)}</div>
  </article>`;
}
function reportActionButtons(r){
  if(!r?.id) return '';
  const id=jsArg(r.id);
  const buttons=[`<button class="report-action" onclick="openReportDetail('${id}',this)">查看</button>`];
  if((r.status||'draft')==='draft') buttons.push(`<button class="report-action" onclick="runReportAction('${id}','submit-review',this)">提交复核</button>`);
  if(r.status==='pending_review') buttons.push(canAdminReports()?`<button class="report-action" onclick="runReportAction('${id}','approve',this)">批准</button>`:`<button class="report-action muted-action" disabled>待管理员批准</button>`);
  if(r.status==='approved') buttons.push(canAdminReports()?`<button class="report-action" onclick="runReportAction('${id}','publish',this)">发布</button>`:`<button class="report-action muted-action" disabled>待管理员发布</button>`);
  return buttons.join('');
}
function currentReportVersion(report){
  const versions=report.versions||[];
  return versions.find(v=>v.id===report.current_version_id)||versions[0]||{};
}
function reportEvidence(report){
  const current=currentReportVersion(report);
  const evidence=parseJsonMaybe(current.evidence_json||'[]');
  if(Array.isArray(evidence)) return evidence;
  return evidence?[evidence]:[];
}
function collectTraceIds(value,set=new Set()){
  if(!value) return set;
  if(typeof value==='string'){
    if(value.startsWith('trace_')) set.add(value);
    return set;
  }
  if(Array.isArray(value)){ value.forEach(v=>collectTraceIds(v,set)); return set; }
  if(typeof value==='object'){
    Object.entries(value).forEach(([key,val])=>{
      if(String(key).toLowerCase().includes('trace') && typeof val==='string') collectTraceIds(val,set);
      else collectTraceIds(val,set);
    });
  }
  return set;
}
function firstEvidenceField(value,fields=[]){
  if(!value) return '';
  if(typeof value==='object'&&!Array.isArray(value)){
    for(const field of fields){
      if(typeof value[field]==='string'&&value[field]) return value[field];
    }
    for(const val of Object.values(value)){
      const found=firstEvidenceField(val,fields);
      if(found) return found;
    }
  }
  if(Array.isArray(value)){
    for(const item of value){
      const found=firstEvidenceField(item,fields);
      if(found) return found;
    }
  }
  return '';
}
function openReportSourceSession(sessionId,btn){
  if(!sessionId) return toast('报告未关联来源会话');
  setBusy(btn,true);
  showPage('chat');
  setTimeout(()=>loadChatSession(sessionId).finally(()=>setBusy(btn,false)),180);
}
function reportEvidenceCards(evidence){
  if(!evidence.length) return emptyState('暂无证据','当前版本未返回结构化 evidence_json。');
  return `<div class="report-evidence-list">${evidence.map((item,i)=>{
    const traces=[...collectTraceIds(item)];
    const title=item.title||item.name||item.source||item.dataset_id||`证据 ${i+1}`;
    return `<article class="evidence-card"><div>${tag(item.type||item.kind||'evidence')}${traces[0]?tag(traces[0],'green'):''}</div><b>${esc(title)}</b><p>${esc(short(item.summary||item.description||item.sql||JSON.stringify(item),140))}</p>${traces[0]?traceActions(traces[0],'openReportTrace'):''}</article>`;
  }).join('')}</div>`;
}
function reportVersionRail(versions=[]){
  return `<div class="version-rail">${versions.length?versions.map(v=>`<div><b>v${esc(v.version||'-')}</b><span>${esc(v.created_by||'-')} · ${esc(timeText(v.created_at))}</span></div>`).join(''):emptyState('暂无版本','报告详情未返回版本记录。')}</div>`;
}
function reportDetailHtml(report){
  const versions=report.versions||[];
  const current=currentReportVersion(report);
  const evidence=reportEvidence(report);
  const traceIds=[...collectTraceIds(evidence)];
  const sourceSessionId=firstEvidenceField(evidence,['session_id']);
  const reportTitle=report.title||report.id;
  const reportId=report.id||reportTitle;
  const reportActions=contextActionStrip([
    sourceSessionId?{label:'打开来源会话',onclick:`openReportSourceSession('${jsArg(sourceSessionId)}',this)`}:null,
    {label:'继续追问',onclick:`setChatDraft('${jsArg(`基于报告“${reportTitle}”继续追问：请解释核心结论、证据来源和下一步建议。`)}','agent_router')`},
    {label:'转深度研究',onclick:`setAnalysisDraft('${jsArg(`基于报告“${reportTitle}”继续做深度复盘：核对证据、风险点和可执行改进项。`)}','agent_business_analysis')`},
    {label:'创建 Codex 任务',onclick:`setCodexDraft('${jsArg(`改进报告体验：${reportTitle}`)}','${jsArg(`围绕报告 ${reportId} 检查报告中心体验、证据 Trace 入口和上下文动作，保持 RBAC、SQL Guard、Trace 和审计能力不退化。`)}')`},
    {label:'加入工作包',onclick:`addReportToContextPack('${jsArg(reportId)}',this)`},
    {label:'查看审计',onclick:`openAuditFiltered('${jsArg(reportId)}')`}
  ].filter(Boolean));
  return `<div class="detail-panel report-detail">
    <div class="card-heading"><div><h3>${esc(report.title||report.id)}</h3><p class="muted">${esc(report.report_type||'report')} · ${esc(report.owner_id||'-')} · ${esc(timeText(report.created_at))}</p></div><div>${statusTag(report.status)}${tag(`${versions.length} versions`)}</div></div>
    <div class="report-actions">${reportActionButtons(report)}${traceIds[0]?`<button class="report-action" onclick="openReportTrace('${jsArg(traceIds[0])}','summary',this)">打开证据 Trace</button>`:''}</div>
    ${reportActions}
    <div class="report-canvas">
      <section><div class="report">${esc(current.content_markdown||'暂无报告正文')}</div></section>
      <aside><h4>版本</h4>${reportVersionRail(versions)}<h4 class="section-gap">证据</h4>${reportEvidenceCards(evidence)}</aside>
    </div>
  </div>`;
}
function knowledgeCard(k,versions=[]){
  return `<button class="knowledge-card ${k.id===activeKnowledgeBaseId?'active':''}" data-kb-id="${esc(k.id)}" onclick="selectKnowledgeBase('${jsArg(k.id)}')">
    <div class="knowledge-icon">${esc((k.type||'K').slice(0,2).toUpperCase())}</div>
    <div><div class="knowledge-head"><b>${esc(k.name||k.id)}</b>${statusTag(k.status||'active')}</div>
    <p>${esc(k.description||'暂无说明')}</p>
    <div class="knowledge-meta">${tag(k.backend_type||'backend')}${k.adapter_id?tag(k.adapter_id):''}${tag(`${versions.length||0} versions`,'green')}</div></div>
  </button>`;
}
function knowledgeMatches(k){
  const q=(knowledgeFilterState.q||'').trim().toLowerCase();
  const backend=knowledgeFilterState.backend||'all';
  const type=knowledgeFilterState.type||'all';
  const versions=knowledgeVersionCache[k.id]||[];
  const bound=knowledgeBindingAgents(k);
  const haystack=[k.id,k.name,k.type,k.backend_type,k.adapter_id,k.description,k.status,...versions.map(v=>v.version||v.status||v.id),...bound.map(a=>`${a.id} ${a.name} ${a.type}`)].filter(Boolean).join(' ').toLowerCase();
  return (backend==='all'||k.backend_type===backend) && (type==='all'||k.type===type) && (!q||haystack.includes(q));
}
function knowledgeFilterOptions(key,items){
  return items.map(([value,label])=>`<option value="${esc(value)}" ${knowledgeFilterState[key]===value?'selected':''}>${esc(label)}</option>`).join('');
}
function knowledgeFilterBar(filtered=[]){
  const backends=[['all','全部后端'],...[...new Set(knowledgeBasesCache.map(k=>k.backend_type).filter(Boolean))].sort().map(v=>[v,displayValue(v)])];
  const types=[['all','全部类型'],...[...new Set(knowledgeBasesCache.map(k=>k.type).filter(Boolean))].sort().map(v=>[v,displayValue(v)])];
  return `<div class="knowledge-filter-bar">
    <label><span>搜索知识库</span><input id="knowledgeSearch" value="${esc(knowledgeFilterState.q)}" placeholder="名称、ID、Adapter、绑定 Agent" oninput="setKnowledgeFilter('q',this.value)" aria-label="搜索知识库"/></label>
    <label><span>后端</span><select id="knowledgeBackendFilter" onchange="setKnowledgeFilter('backend',this.value)" aria-label="筛选知识库后端">${knowledgeFilterOptions('backend',backends)}</select></label>
    <label><span>类型</span><select id="knowledgeTypeFilter" onchange="setKnowledgeFilter('type',this.value)" aria-label="筛选知识库类型">${knowledgeFilterOptions('type',types)}</select></label>
    <button class="report-action" onclick="resetKnowledgeFilters()">重置</button>
    <small id="knowledgeResultCount" class="knowledge-filter-count">显示 ${filtered.length} / ${knowledgeBasesCache.length}</small>
  </div>`;
}
function renderKnowledgeList(){
  const filtered=knowledgeBasesCache.filter(knowledgeMatches);
  const grid=document.getElementById('knowledgeAssetGrid');
  if(grid) grid.innerHTML=filtered.length?filtered.map(k=>knowledgeCard(k,knowledgeVersionCache[k.id]||[])).join(''):emptyState('没有匹配知识库','调整搜索、后端或类型筛选。');
  const table=document.getElementById('knowledgeTablePanel');
  if(table) table.innerHTML=renderTable(filtered,{columns:['id','name','type','backend_type','adapter_id','description','status'],limit:80});
  const count=document.getElementById('knowledgeResultCount');
  if(count) count.innerText=`显示 ${filtered.length} / ${knowledgeBasesCache.length}`;
  if(activeKnowledgeBaseId && !filtered.some(k=>k.id===activeKnowledgeBaseId)){
    activeKnowledgeBaseId=filtered[0]?.id||'';
    if(activeKnowledgeBaseId) selectKnowledgeBase(activeKnowledgeBaseId);
  }
}
function setKnowledgeFilter(key,value){
  knowledgeFilterState[key]=value;
  renderKnowledgeList();
}
function resetKnowledgeFilters(){
  knowledgeFilterState={q:'',backend:'all',type:'all'};
  const q=document.getElementById('knowledgeSearch');
  if(q) q.value='';
  const backend=document.getElementById('knowledgeBackendFilter');
  if(backend) backend.value='all';
  const type=document.getElementById('knowledgeTypeFilter');
  if(type) type.value='all';
  renderKnowledgeList();
}
function evalSetCard(s,cases=[]){
  const tags=evalSetTags(s,cases);
  return `<button class="eval-card ${s.id===activeEvalSetId?'active':''}" data-eval-set-id="${esc(s.id)}" onclick="selectEvalSet('${jsArg(s.id)}')">
    <div class="eval-card-head"><div><span>${esc(s.business_domain||'Evaluation')}</span><b>${esc(s.name||s.id)}</b></div>${tag(`${cases.length} cases`,'green')}</div>
    <p>${esc(s.description||'暂无说明')}</p>
    <div class="eval-tags">${compactTags(tags,5)}</div>
  </button>`;
}
function evalSetTags(s,cases=[]){
  return [...new Set(cases.flatMap(c=>asList(c.tags)).concat([s.business_domain]).filter(Boolean))];
}
function evalSetSearchText(s,cases=[]){
  return [s.id,s.name,s.business_domain,s.description,s.owner_id,...cases.flatMap(c=>[c.id,c.question,c.expected_answer,c.expected_sql,...asList(c.tags)])].filter(Boolean).join(' ').toLowerCase();
}
function evalSetMatches(s){
  const cases=evalCaseCache[s.id]||[];
  const q=(evalFilterState.q||'').trim().toLowerCase();
  const domain=evalFilterState.domain||'all';
  const selectedTag=evalFilterState.tag||'all';
  const tags=evalSetTags(s,cases);
  return (domain==='all'||s.business_domain===domain) && (selectedTag==='all'||tags.includes(selectedTag)) && (!q||evalSetSearchText(s,cases).includes(q));
}
function evalFilterOptions(key,items){
  return items.map(([value,label])=>`<option value="${esc(value)}" ${evalFilterState[key]===value?'selected':''}>${esc(label)}</option>`).join('');
}
function evalFilterBar(filtered=[]){
  const allCases=Object.values(evalCaseCache).flat();
  const domains=[['all','全部业务域'],...[...new Set(evalSetsCache.map(s=>s.business_domain).filter(Boolean))].sort().map(v=>[v,v])];
  const tags=[['all','全部标签'],...[...new Set(allCases.flatMap(c=>asList(c.tags)).filter(Boolean))].sort().map(v=>[v,v])];
  return `<div class="eval-filter-bar">
    <label><span>搜索评测资产</span><input id="evalSearch" value="${esc(evalFilterState.q)}" placeholder="评测集、问题、SQL、标签" oninput="setEvalFilter('q',this.value)" aria-label="搜索评测资产"/></label>
    <label><span>业务域</span><select id="evalDomainFilter" onchange="setEvalFilter('domain',this.value)" aria-label="筛选评测业务域">${evalFilterOptions('domain',domains)}</select></label>
    <label><span>标签</span><select id="evalTagFilter" onchange="setEvalFilter('tag',this.value)" aria-label="筛选评测标签">${evalFilterOptions('tag',tags)}</select></label>
    <button class="report-action" onclick="resetEvalFilters()">重置</button>
    <small id="evalResultCount" class="eval-filter-count">显示 ${filtered.length} / ${evalSetsCache.length}</small>
  </div>`;
}
function evalResultPayload(row){
  if(!row) return {};
  if(typeof row.result_json==='string') return parseJsonMaybe(row.result_json)||{};
  return row.result_json||{};
}
function evalTraceId(row){return evalResultPayload(row).trace_id||''}
function scoreClass(score){
  const v=Number(score||0);
  if(v>=0.8) return 'green';
  if(v>=0.6) return 'amber';
  return 'red';
}
function evalRunSummary(run){
  const results=run.results||[];
  const scores=results.map(r=>Number(r.score||0));
  const avg=scores.length?scores.reduce((a,b)=>a+b,0)/scores.length:0;
  return {count:results.length,avg,passed:scores.filter(s=>s>=0.8).length,needsReview:scores.filter(s=>s<0.8).length,low:results.filter(r=>Number(r.score||0)<0.8)};
}
function evalResultCard(row,index){
  const payload=evalResultPayload(row), traceId=evalTraceId(row), score=Number(row.score||0);
  return `<article class="eval-result-card ${score<0.8?'needs-review':''}">
    <div class="eval-result-head"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(row.question||row.eval_case_id||'评测用例')}</b><p>${esc(payload.answer||'暂无回答摘要')}</p></div>${tag(fmt(score),scoreClass(score))}</div>
    <div class="eval-result-meta">${tag(row.error_type||'no error',row.error_type?'red':'green')}${row.reviewer_id?tag(row.reviewer_id):tag('unreviewed','amber')}${traceId?tag(traceId):''}</div>
    ${traceId?`<div class="eval-actions"><button class="report-action" onclick="openEvalTrace('${jsArg(traceId)}','summary',this)">Trace 总览</button><button class="report-action" onclick="openEvalTrace('${jsArg(traceId)}','sql',this)">SQL</button><button class="report-action" onclick="openEvalTrace('${jsArg(traceId)}','permission',this)">权限</button></div>`:''}
  </article>`;
}
function evalRunHtml(run){
  const s=evalRunSummary(run);
  return `${stateBanner('success','评测已完成','结果已转换为质量面板，可直接下钻 Trace 证据。',[run.id||'eval-run',run.status||'success'])}
  <div class="eval-run-shell">
    <section class="eval-run-main">
      <div class="metric-grid tight">${metricCard('用例数',s.count,'本次运行覆盖的问题')}${metricCard('平均分',fmt(s.avg),'0.80 以上视为通过')}${metricCard('通过',s.passed,'达到默认门槛')}${metricCard('需复核',s.needsReview,'低于默认门槛或需人工判断')}</div>
      ${s.low.length?stateBanner('warn','存在需复核用例',`${s.low.length} 条结果低于 0.80，建议查看 Trace 与答案摘要。`):stateBanner('success','质量门槛通过','所有结果达到默认门槛。')}
      <div class="eval-result-list">${(run.results||[]).length?(run.results||[]).map(evalResultCard).join(''):emptyState('暂无评测结果','该评测运行没有返回用例结果。')}</div>
    </section>
    <aside class="eval-trace-drawer"><div class="pane-title"><span>Trace</span><div><h2>评测证据</h2><p>点击左侧结果卡片查看对应执行链路。</p></div></div><div id="evalTraceBox">${emptyState('未选择 Trace','选择评测结果后会显示 SQL、权限检查和执行步骤。')}</div></aside>
  </div>`;
}
function workflowRail(steps){
  return `<div class="workflow-rail">${steps.map((s,i)=>`<div class="workflow-step"><span>${i+1}</span><div><b>${esc(s[0])}</b><p>${esc(s[1])}</p></div></div>`).join('')}</div>`;
}
function actionButton(label){
  return `<button class="action-chip" onclick="handleNextAction('${jsArg(label)}')">${esc(label)}</button>`;
}
function traceButton(traceId){
  return traceId?`<button class="trace-chip" onclick="openTrace('${jsArg(traceId)}')">打开 Trace</button>`:'';
}
function evidenceLinks(r, meta={}){
  const traceId=r?.trace_id||meta.trace_id||'';
  if(!traceId) return '';
  const items=[['summary','总览'],['sql','SQL'],['permission','权限'],['steps','步骤']];
  if((r?.tables||[]).length) items.push(['result','结果表']);
  if((r?.charts||[]).length) items.push(['chart','图表']);
  return `<div class="evidence-links" aria-label="回答证据定位"><span>证据</span>${items.map(([target,label])=>`<button onclick="openEvidence('${jsArg(traceId)}','${target}')">${esc(label)}</button>`).join('')}</div>`;
}
function feedbackControls(r, meta={}){
  const traceId=r?.trace_id||meta.trace_id||'';
  const sessionId=meta.session_id||activeSessionId||'';
  const messageId=meta.message_id||'';
  if(!traceId && !sessionId) return '';
  const ratings=[['correct','准确'],['partial','部分可用'],['wrong','有误'],['needs_review','需复核']];
  return `<div class="feedback-bar" aria-label="回答反馈"><span>这次回答</span>${ratings.map(([rating,label])=>`<button onclick="sendFeedback('${rating}','${jsArg(traceId)}','${jsArg(sessionId)}','${jsArg(messageId)}',this)">${esc(label)}</button>`).join('')}<small class="feedback-status"></small></div>`;
}
function answerPlainText(r){
  const parts=[r?.answer||'', r?.report_markdown||''];
  (r?.warnings||[]).forEach(w=>parts.push(`注意：${w}`));
  return parts.filter(Boolean).join('\n\n')||JSON.stringify(r||{},null,2);
}
function cacheAnswerDraft(r,meta={}){
  const key=meta.message_id || r?.trace_id || meta.trace_id || `answer_${Object.keys(answerDraftCache).length+1}`;
  answerDraftCache[key]={r,meta};
  return key;
}
function answerQuestion(meta={}){
  return meta.question || currentQuestionText() || '当前问题';
}
function setChatComposerDraft(prompt, agentId='', datasetId=''){
  if(activePage!=='chat'){
    setChatDraft(prompt,agentId,datasetId);
    return;
  }
  const agent=document.getElementById('chatAgent');
  if(agentId&&agent&&[...agent.options].some(o=>o.value===agentId)) agent.value=agentId;
  const dataset=document.getElementById('chatDataset');
  if(datasetId&&dataset&&[...dataset.options].some(o=>o.value===datasetId)) dataset.value=datasetId;
  const input=document.getElementById('chatInput');
  if(input){ input.value=prompt; input.focus(); }
  syncChatContextBar();
}
async function copyAnswerText(text,btn,success='答案已复制'){
  setBusy(btn,true);
  try{
    if(navigator.clipboard?.writeText) await navigator.clipboard.writeText(text);
    else{
      const el=document.createElement('textarea');
      el.value=text;
      el.style.position='fixed';
      el.style.opacity='0';
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      el.remove();
    }
    toast(success);
  }catch(e){
    toast('复制失败：'+e.message);
  }finally{
    setBusy(btn,false);
  }
}
function answerBrief(r, meta={}){
  const traceId=r?.trace_id||meta.trace_id||'';
  const confidence=Number(r?.confidence||0);
  const confidenceLabel=confidence?`${Math.round(confidence*100)}%`:'-';
  const tableRows=(r?.tables||[]).reduce((sum,t)=>sum+(t.rows||[]).length,0);
  const items=[
    ['可信度',confidenceLabel,'模型/规则返回'],
    ['证据',traceId?'Trace linked':'no trace',traceId||'未返回 trace_id'],
    ['结果',`${(r?.tables||[]).length} 表 / ${(r?.charts||[]).length} 图`,`${tableRows} 行可见数据`],
    ['后续',`${(r?.next_actions||[]).length} actions`,(r?.warnings||[]).length?`${r.warnings.length} 条注意事项`:'无警告']
  ];
  return `<div class="answer-brief-grid">${items.map(([label,value,note])=>`<div class="answer-brief-item"><span>${esc(label)}</span><b>${esc(value)}</b><small>${esc(note)}</small></div>`).join('')}</div>`;
}
function reportMarkdownFromAnswer(r,meta={}){
  const question=answerQuestion(meta);
  const lines=[
    `# ${question}`,
    '',
    '## 回答',
    r?.answer||'暂无回答正文',
  ];
  if(r?.report_markdown) lines.push('', '## 报告草稿', r.report_markdown);
  if((r?.warnings||[]).length) lines.push('', '## 注意事项', ...(r.warnings||[]).map(w=>`- ${w}`));
  if((r?.next_actions||[]).length) lines.push('', '## 后续动作', ...(r.next_actions||[]).map(a=>`- ${a}`));
  (r?.tables||[]).forEach((t,i)=>{
    lines.push('', `## 表格 ${i+1}: ${t.name||'query_result'}`, `共 ${(t.rows||[]).length} 行；字段：${(t.columns||Object.keys((t.rows||[])[0]||{})).join(', ') || '-'}`);
  });
  (r?.charts||[]).forEach((c,i)=>lines.push('', `## 图表 ${i+1}: ${c.title||c.chart_type||'chart'}`, `类型：${c.chart_type||'-'}`));
  lines.push('', '## Trace', r?.trace_id||meta.trace_id||'未返回 Trace');
  return lines.join('\n');
}
function answerFollowUpPrompts(r,meta={}){
  const question=answerQuestion(meta);
  const answer=short(r?.answer||r?.report_markdown||'当前回答',160);
  const traceId=r?.trace_id||meta.trace_id||'';
  const prompts=[
    {
      label:'核对证据',
      prompt:`基于上一轮问题“${question}”继续核对证据：请结合 Trace${traceId?` ${traceId}`:''}、SQL、权限检查和结果行数，说明哪些结论可靠、哪些需要复核。`
    },
    {
      label:'继续下钻',
      prompt:`围绕“${question}”继续下钻：请按时间、渠道、区域或客户分组拆解关键差异，并给出最值得追问的异常点。`
    },
    {
      label:'转为行动',
      prompt:`把上一轮回答“${answer}”转成可执行下一步：输出报告结构、风险提醒、负责人要确认的问题，以及是否需要深度研究或 Codex 任务。`
    }
  ];
  (r?.next_actions||[]).slice(0,1).forEach(action=>{
    prompts.unshift({
      label:'执行建议',
      prompt:`基于上一轮建议“${action}”继续推进：请说明执行路径、所需证据、风险边界和完成标准。`
    });
  });
  return prompts.slice(0,3);
}
function answerFollowUpSuggestions(r,meta={}){
  const prompts=answerFollowUpPrompts(r,meta);
  if(!prompts.length) return '';
  return `<div class="answer-followups" aria-label="建议追问"><span>继续问</span>${prompts.map(item=>`<button class="answer-suggestion" data-prompt="${esc(item.prompt)}" onclick="setChatComposerDraft(this.dataset.prompt)">${esc(item.label)}</button>`).join('')}</div>`;
}
function answerCanvasMarkdown(r,meta={}){
  const question=answerQuestion(meta);
  const traceId=r?.trace_id||meta.trace_id||'';
  const ctx=chatContextSnapshot();
  const toolLabels={auto:'自动',analysis:'分析',sql:'SQL',codex:'Codex'};
  const lines=[
    `# 问数结论：${question}`,
    '',
    '## 会话上下文',
    `- Agent：${ctx.agent?.name||ctx.agent?.id||'自动路由'}`,
    `- 数据集：${ctx.dataset?.name||'自动选择'}`,
    `- 工具模式：${toolLabels[ctx.toolMode]||displayValue(ctx.toolMode||'auto')}`,
    `- 证据：${traceId||'未返回 Trace'}`,
    '',
    '## 回答',
    r?.answer||'暂无回答正文'
  ];
  if(r?.report_markdown) lines.push('', '## 报告草稿', r.report_markdown);
  if((r?.warnings||[]).length) lines.push('', '## 注意事项', ...(r.warnings||[]).map(w=>`- ${w}`));
  if((r?.tables||[]).length){
    lines.push('', '## 数据结果');
    (r.tables||[]).forEach((t,i)=>lines.push(`- 表格 ${i+1}：${t.name||'query_result'}，${(t.rows||[]).length} 行，字段 ${(t.columns||Object.keys((t.rows||[])[0]||{})).join('、')||'-'}`));
  }
  if((r?.charts||[]).length){
    lines.push('', '## 图表');
    (r.charts||[]).forEach((c,i)=>lines.push(`- 图表 ${i+1}：${c.title||c.chart_type||'chart'} (${c.chart_type||'-'})`));
  }
  const followUps=answerFollowUpPrompts(r,meta);
  if((r?.next_actions||[]).length||followUps.length){
    lines.push('', '## 下一步');
    (r?.next_actions||[]).forEach(a=>lines.push(`- ${a}`));
    followUps.forEach(item=>lines.push(`- ${item.label}：${item.prompt}`));
  }
  lines.push('', '## 审计与边界', '- 保存报告或创建任务前继续保留 Trace、RBAC、SQL Guard 和审计链路。');
  return lines.join('\n');
}
function answerNextStepsMarkdown(r,meta={}){
  const question=answerQuestion(meta);
  const traceId=r?.trace_id||meta.trace_id||'';
  const actions=(r?.next_actions||[]).length ? r.next_actions : answerFollowUpPrompts(r,meta).map(item=>item.prompt);
  return [`# 下一步：${question}`,'',`- Trace：${traceId||'待复核'}`,'- 目标：把当前回答转为可验证的业务动作或工程任务。','', '## 建议动作', ...actions.map(a=>`- ${a}`), '', '## 完成标准', '- 结论能回到 SQL、权限检查、结果行数和 Trace 步骤。', '- 风险、数据分级和 masking 边界已注明。', '- 需要工程改动时进入 Codex 审批流程。'].join('\n');
}
function focusChatCanvas(){
  requestAnimationFrame(()=>{
    const el=document.getElementById('chatCanvasDraft');
    if(!el) return;
    el.focus();
    const end=el.value.length;
    el.setSelectionRange(end,end);
  });
}
function writeAnswerToCanvas(key,mode='replace'){
  const cached=answerDraftCache[key];
  if(!cached) return toast('回答上下文已失效，请重新打开会话');
  const {r,meta}=cached;
  const markdown=mode==='next' ? answerNextStepsMarkdown(r,meta) : answerCanvasMarkdown(r,meta);
  const existing=chatCanvasValue().trim();
  const next=mode==='append'&&existing ? `${existing}\n\n---\n\n${markdown}` : markdown;
  const status=mode==='append'?'回答已追加到 Canvas':mode==='next'?'下一步已写入 Canvas':'回答已写入 Canvas';
  setChatCanvasDraft(next,status,{reason:status});
  focusChatCanvas();
}
function reportEvidenceFromAnswer(r,meta={}){
  return [{
    type:'chat_answer',
    title:answerQuestion(meta),
    summary:r?.answer||'Agent answer',
    trace_id:r?.trace_id||meta.trace_id||'',
    session_id:meta.session_id||activeSessionId||'',
    message_id:meta.message_id||'',
    answer_type:r?.answer_type||'text',
    confidence:r?.confidence??null,
    table_count:(r?.tables||[]).length,
    chart_count:(r?.charts||[]).length
  }];
}
async function saveAnswerAsReport(key,btn){
  const cached=answerDraftCache[key];
  if(!cached) return toast('回答上下文已失效，请重新打开会话');
  const {r,meta}=cached;
  setBusy(btn,true);
  try{
    const title=short(`问数报告：${answerQuestion(meta)}`,120);
    const report=await api('/api/reports',{method:'POST',body:JSON.stringify({
      title,
      report_type:'chat_answer',
      agent_id:document.getElementById('chatAgent')?.value||null,
      content_markdown:reportMarkdownFromAnswer(r,meta),
      evidence:reportEvidenceFromAnswer(r,meta)
    })});
    toast('已保存为报告草稿');
    showPage('reports');
    setTimeout(()=>openReportDetail(report.id,null),160);
  }catch(e){
    toast('保存报告失败：'+e.message);
  }finally{
    setBusy(btn,false);
  }
}
function answerContextActions(r, meta={}, key=''){
  const traceId=r?.trace_id||meta.trace_id||'';
  const question=answerQuestion(meta);
  const answer=short(r?.answer||r?.report_markdown||'当前回答',180);
  const followUp=`基于上一次问题“${question}”继续追问：请展开最关键的证据、异常点和下一步动作。`;
  const research=`基于问题“${question}”和回答“${answer}”继续做深度研究：核对 SQL/Trace 证据，找出原因、风险和可执行建议。`;
  const codexPrompt=`围绕问数结果“${question}”完善数据智能体平台体验：把回答、证据、后续动作和 Trace 复核做成更顺滑的工作流，保持 RBAC、SQL Guard、Trace、审计和审批能力不退化，并运行 python3 scripts/static_check.py。`;
  const copyText=answerPlainText(r);
  const actions=[
    `<button class="answer-tool" data-prompt="${esc(followUp)}" onclick="setChatComposerDraft(this.dataset.prompt)">继续追问</button>`,
    key?`<button class="answer-tool" onclick="writeAnswerToCanvas('${jsArg(key)}','replace')">写入 Canvas</button>`:'',
    key?`<button class="answer-tool" onclick="writeAnswerToCanvas('${jsArg(key)}','append')">追加 Canvas</button>`:'',
    key?`<button class="answer-tool" onclick="writeAnswerToCanvas('${jsArg(key)}','next')">提取下一步</button>`:'',
    `<button class="answer-tool" data-prompt="${esc(research)}" onclick="setAnalysisDraft(this.dataset.prompt,'agent_business_analysis')">转深度研究</button>`,
    `<button class="answer-tool" data-title="优化问数工作流" data-prompt="${esc(codexPrompt)}" onclick="setCodexDraft(this.dataset.title,this.dataset.prompt)">创建 Codex 任务</button>`,
    key?`<button class="answer-tool" onclick="saveAnswerAsReport('${jsArg(key)}',this)">保存报告</button>`:'',
    traceId?`<button class="answer-tool" onclick="openEvidence('${jsArg(traceId)}','steps')">定位证据</button>`:'',
    traceId?`<button class="answer-tool" onclick="addTraceToContextPack('${jsArg(traceId)}',this)">加入工作包</button>`:'',
    `<button class="answer-tool ghost-tool" data-copy="${esc(copyText)}" onclick="copyAnswerText(this.dataset.copy,this)">复制</button>`
  ].filter(Boolean);
  return `<div class="answer-toolstrip" aria-label="回答后续动作">${actions.join('')}</div>`;
}
function parseJsonMaybe(text){
  try{return JSON.parse(text)}catch(e){return null}
}
function taskResultPayload(task){
  const raw=task?.result_json;
  if(!raw) return {};
  if(typeof raw==='string') return parseJsonMaybe(raw)||{};
  return raw;
}
function taskTraceId(task){
  const payload=taskResultPayload(task);
  const ref=task?.result_ref||'';
  return payload.trace_id || (String(ref).startsWith('trace_')?ref:'');
}
function taskProgressValue(task){
  if(Number.isFinite(Number(task?.progress))) return Math.max(0,Math.min(100,Number(task.progress)));
  return task?.status==='success'||task?.status==='completed'?100:task?.status==='failed'?100:10;
}
function taskQueueSummary(tasks=[]){
  return {
    total:tasks.length,
    active:tasks.filter(t=>['pending','running','awaiting_approval','ready'].includes(t.status)).length,
    done:tasks.filter(t=>['success','completed'].includes(t.status)).length,
    failed:tasks.filter(t=>['failed','error'].includes(t.status)).length
  };
}
function taskQueueCard(task,detailId='dashboardTaskDetail',traceHandler='openDashboardTrace'){
  const traceId=taskTraceId(task);
  const progress=taskProgressValue(task);
  return `<button class="task-queue-card ${statusClass(task.status)}" onclick="openTaskDetail('${jsArg(detailId)}','${jsArg(task.id)}','${jsArg(traceHandler)}')">
    <div class="task-queue-head"><div><span>${esc(displayValue(task.task_type||'task'))}</span><b>${esc(task.id)}</b></div>${statusTag(task.status)}</div>
    <div class="task-progress" aria-label="任务进度"><i style="width:${progress}%"></i></div>
    <p>${esc(short(task.error_message||taskResultPayload(task).answer||taskResultPayload(task).question||task.result_ref||'等待任务输出',110))}</p>
    <div class="task-queue-meta">${tag(`${progress}%`)}${task.agent_id?tag(task.agent_id):''}${traceId?tag(traceId,'green'):tag('no-trace','amber')}</div>
  </button>`;
}
function taskQueuePanel(tasks=[],opts={}){
  const id=opts.detailId||'dashboardTaskDetail';
  const traceHandler=opts.traceHandler||'openDashboardTrace';
  const summary=taskQueueSummary(tasks);
  const shown=tasks.slice(0,opts.limit||8);
  return `<div class="task-queue-panel">
    <div class="section-title"><div><h2>${esc(opts.title||'最近任务')}</h2><p>${esc(opts.description||'聚合研究、报告和工程任务，便于从控制塔继续进入证据链。')}</p></div>${tag(`${summary.total} tasks`)}</div>
    <div class="task-queue-metrics">${metricCard('活动中',summary.active,'待审批或执行')}${metricCard('已完成',summary.done,'成功闭环')}${metricCard('异常',summary.failed,'需要复核')}</div>
    <div class="task-queue-list">${shown.length?shown.map(t=>taskQueueCard(t,id,traceHandler)).join(''):emptyState('暂无任务','创建深度研究或 Codex 任务后会出现在这里。')}</div>
    <div id="${esc(id)}" class="task-detail-card">${emptyState('选择任务','点击左侧任务后显示结果 JSON、Trace 和继续动作。')}</div>
  </div>`;
}
async function openTaskDetail(detailId,taskId,traceHandler='openDashboardTrace'){
  const box=document.getElementById(detailId);
  if(!box) return;
  box.innerHTML=inlineLoading('正在读取任务详情');
  try{
    const task=await api('/api/tasks/'+taskId);
    const payload=taskResultPayload(task);
    const traceId=taskTraceId(task);
    if((task.task_type||'').includes('analysis')) lastAnalysisTaskId=task.id;
    box.innerHTML=`<div class="task-detail">
      <div class="card-heading"><div><h3>${esc(task.id)}</h3><p class="muted">${esc(displayValue(task.task_type||'task'))} · ${esc(timeText(task.created_at))}</p></div>${statusTag(task.status)}</div>
      <div class="task-queue-meta">${task.agent_id?tag(task.agent_id):''}${tag(`${taskProgressValue(task)}%`)}${traceId?tag(traceId,'green'):tag('no-trace','amber')}</div>
      ${traceId?traceActions(traceId,traceHandler):stateBanner('warn','暂无 Trace','该任务没有可定位的 Trace ID。')}
      ${(task.task_type||'').includes('analysis')?`<button class="secondary" onclick="showPage('analysis');setTimeout(()=>loadLastAnalysisTask(null),80)">在深度研究中打开</button>`:''}
      ${task.error_message?stateBanner('error','任务错误',task.error_message):''}
      <details open><summary>结果 JSON</summary><pre class="code">${esc(JSON.stringify(payload||{},null,2))}</pre></details>
    </div>`;
  }catch(e){
    box.innerHTML=stateBanner('error','任务详情加载失败',e.message);
  }
}
function messageTraceId(message){
  if(message?.content_type!=='agent_result') return '';
  const parsed=parseJsonMaybe(message.content);
  return parsed?.trace_id || '';
}
function latestTraceId(messages=[]){
  for(let i=messages.length-1;i>=0;i--){
    const id=messageTraceId(messages[i]);
    if(id) return id;
  }
  return '';
}
function questionCanvasMarkdown(text){
  const ctx=chatContextSnapshot();
  const question=String(text||'').trim();
  return [`# 提问草稿：${question||'当前问题'}`,'',`- Agent：${ctx.agent?.name||ctx.agent?.id||'自动路由'}`,`- 数据集：${ctx.dataset?.name||'自动选择'}`,`- 工具模式：${displayValue(ctx.toolMode||'auto')}`,'', '## 复用意图', question||'待补充问题', '', '## 继续方向', '- 编辑后重新发送，或转为深度研究 / Codex 任务。', '- 若涉及 SQL，继续通过 SQL Guard、RBAC、Trace 和审计链路验证。'].join('\n');
}
function writeQuestionToCanvas(text,mode='append'){
  const markdown=questionCanvasMarkdown(text);
  const existing=chatCanvasValue().trim();
  const next=mode==='append'&&existing ? `${existing}\n\n---\n\n${markdown}` : markdown;
  setChatCanvasDraft(next,mode==='append'?'问题已追加到 Canvas':'问题已写入 Canvas',{reason:'问题写入 Canvas'});
  focusChatCanvas();
}
function rerunUserQuestion(prompt,btn){
  setChatComposerDraft(prompt);
  requestAnimationFrame(()=>sendChat(btn));
}
function branchUserQuestion(prompt,btn){
  const text=String(prompt||'').trim();
  if(!text) return toast('问题为空，无法创建分支');
  startNewChat();
  setChatComposerDraft(text);
  toast('已开启分支对话');
  requestAnimationFrame(()=>sendChat(btn));
}
function userMessageActions(text){
  const prompt=String(text||'');
  return `<div class="message-actions" aria-label="用户消息操作">
    <button data-prompt="${esc(prompt)}" onclick="setChatComposerDraft(this.dataset.prompt)">编辑</button>
    <button data-prompt="${esc(prompt)}" onclick="rerunUserQuestion(this.dataset.prompt,this)">重问</button>
    <button data-prompt="${esc(prompt)}" onclick="branchUserQuestion(this.dataset.prompt,this)">分支</button>
    <button data-prompt="${esc(prompt)}" onclick="writeQuestionToCanvas(this.dataset.prompt,'append')">写入 Canvas</button>
    <button data-copy="${esc(prompt)}" onclick="copyAnswerText(this.dataset.copy,this)">复制</button>
  </div>`;
}
function userMessageHtml(content){
  return `<div class="message user"><div>${esc(content)}</div>${userMessageActions(content)}</div>`;
}
function resultHtml(r, meta={}){
  const answerKey=cacheAnswerDraft(r,meta);
  return `<div class="answer-title">${tag('Agent Response','green')}<b>${esc(r.answer||'已返回结果')}</b>${traceButton(r.trace_id||meta.trace_id)}</div>
  ${answerBrief(r,meta)}
  ${answerContextActions(r,meta,answerKey)}
  ${evidenceLinks(r,meta)}
  ${answerFollowUpSuggestions(r,meta)}
  ${r.report_markdown?`<div class="report">${esc(r.report_markdown)}</div>`:''}
  ${r.codex_task?`<div class="code">Codex Task: ${esc(r.codex_task.id)} / ${esc(r.codex_task.status)} / ${esc(r.codex_task.mode)}</div>`:''}
  ${(r.warnings||[]).map(w=>`<div class="status-warn">${esc(w)}</div>`).join('')}
  ${(r.tables||[]).map(t=>`<h4>${esc(displayKey(t.name||'表格'))}</h4>${renderTable(t.rows||[])}`).join('')}
  ${(r.charts||[]).map(renderChart).join('')}
  ${(r.next_actions||[]).length?`<div class="action-list">${r.next_actions.map(actionButton).join('')}</div>`:''}
  ${feedbackControls(r,meta)}`;
}
function previousUserMessage(messages=[],index=0){
  for(let i=index-1;i>=0;i--){
    if(messages[i]?.role==='user') return messages[i].content||'';
  }
  return '';
}
function chatMessageHtml(message, sessionId='', messages=[], index=0){
  if(message.role==='user') return userMessageHtml(message.content);
  const parsed=message.content_type==='agent_result'?parseJsonMaybe(message.content):null;
  return `<div class="message assistant rich-message">${parsed?resultHtml(parsed,{session_id:sessionId,message_id:message.id,trace_id:parsed.trace_id,question:previousUserMessage(messages,index)}):esc(message.content)}</div>`;
}
function chatBriefMessages(){
  return (activeChatMessages||[]).filter(m=>['user','assistant'].includes(m.role)&&String(m.content||'').trim());
}
function syncChatBriefControls(){
  const hasMessages=chatBriefMessages().length>0;
  document.querySelectorAll('.brief-strip button').forEach(btn=>{btn.disabled=!hasMessages;});
}
function assistantMessageText(message){
  const parsed=message?.content_type==='agent_result'?parseJsonMaybe(message.content):null;
  if(parsed){
    const parts=[parsed.answer||'',parsed.report_markdown||''];
    (parsed.warnings||[]).forEach(w=>parts.push(`注意：${w}`));
    return parts.filter(Boolean).join('\n\n');
  }
  return String(message?.content||'');
}
function briefBulletLines(text,limit=5){
  const cleaned=String(text||'')
    .replace(/```[\s\S]*?```/g,'')
    .split(/\n+/)
    .map(line=>line.replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+\.\s+)/,'').trim())
    .filter(Boolean)
    .filter(line=>!/^Trace[:：]/i.test(line))
    .slice(0,limit);
  return cleaned.length?cleaned.map(line=>`- ${short(line,130)}`):['- 待生成可复用回答摘要。'];
}
function buildChatBriefMarkdown(){
  const messages=chatBriefMessages();
  if(!messages.length) return '';
  const ctx=chatContextSnapshot();
  const title=(document.getElementById('chatSessionTitle')?.innerText||messages.find(m=>m.role==='user')?.content||'当前会话').trim();
  const questions=messages.filter(m=>m.role==='user').map(m=>String(m.content||'').trim()).filter(Boolean);
  const latestAnswer=[...messages].reverse().find(m=>m.role==='assistant');
  const traceIds=[...new Set([...messages.map(messageTraceId).filter(Boolean), activeTraceId()].filter(Boolean))].slice(0,6);
  const context=normalizeContextPack(contextPack);
  const lines=[
    `# 会话 Brief：${title}`,
    '',
    `- 生成时间：${new Date().toISOString()}`,
    `- 会话：${activeSessionId||'尚未保存的新对话'}`,
    `- Agent：${ctx.agent?.name||ctx.agent?.id||'自动路由'}`,
    `- 数据集：${ctx.dataset?.name||'自动选择'}`,
    `- 工具模式：${displayValue(ctx.toolMode)}`,
    `- 证据深度：${ctx.evidenceDepth==='full'?'完整证据':'标准 Trace'}`,
    `- 记忆边界：${context.memoryMode==='project'?'项目内':'默认会话'}`,
    '',
    '## 关键问题',
    ...(questions.length?questions.slice(-6).map(q=>`- ${short(q,140)}`):['- 尚未记录用户问题。']),
    '',
    '## 最新回答摘要',
    ...briefBulletLines(latestAnswer?assistantMessageText(latestAnswer):'',5),
    '',
    '## 证据与边界',
    `- Trace：${traceIds.length?traceIds.join('、'):'待生成 Trace'}`,
    '- RBAC、SQL Guard、masking 和审计仍以后端结果为准。',
    '- 该 Brief 是当前浏览器会话快照，不是公开分享链接。',
    '',
    '## 下一步',
    '- 将 Brief 写入 Canvas 后继续整理为报告草稿。',
    '- 如需扩大问题范围，可转深度研究或创建 Codex 工程任务。',
    '- 保存报告前复核 Trace、SQL、权限和数据分级。'
  ];
  return lines.join('\n');
}
function writeChatBriefToCanvas(btn){
  const brief=buildChatBriefMarkdown();
  if(!brief) return toast('当前会话还没有可生成 Brief 的消息');
  setBusy(btn,true);
  try{
    const existing=chatCanvasValue().trim();
    const next=existing?`${existing}\n\n---\n\n${brief}`:brief;
    setChatCanvasDraft(next,existing?'会话 Brief 已追加到 Canvas':'会话 Brief 已写入 Canvas',{reason:'会话 Brief'});
  }finally{
    setBusy(btn,false);
  }
}
function copyChatBrief(btn){
  const brief=buildChatBriefMarkdown();
  if(!brief) return toast('当前会话还没有可复制的 Brief');
  return copyAnswerText(brief,btn,'会话 Brief 已复制');
}
function downloadChatBriefMarkdown(btn){
  const brief=buildChatBriefMarkdown();
  if(!brief) return toast('当前会话还没有可下载的 Brief');
  setBusy(btn,true);
  try{
    const date=new Date().toISOString().slice(0,10);
    const title=document.getElementById('chatSessionTitle')?.innerText||'chat-brief';
    const filename=`${safeDownloadStem(title,'chat-brief')}-brief-${date}.md`;
    const blob=new Blob([brief+'\n'],{type:'text/markdown;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),0);
    toast('会话 Brief 已下载');
  }catch(e){
    toast('下载 Brief 失败：'+e.message);
  }finally{
    setBusy(btn,false);
  }
}
function sessionTitle(s){
  return short(s.title||s.id||'新会话',42);
}
function auditActionClass(action){
  const s=String(action||'').toLowerCase();
  if(s.includes('failed')||s.includes('reject')||s.includes('error')) return 'red';
  if(s.includes('approve')||s.includes('publish')||s.includes('login')||s.includes('query')) return 'green';
  return 'amber';
}
function auditTimelineItem(log){
  return `<button class="audit-item" onclick="selectAuditEvent('${jsArg(log.id||'')}')"><div>${tag(displayValue(log.action||'action'),auditActionClass(log.action))}</div><b>${esc(log.object_type||'platform')} / ${esc(log.object_id||'-')}</b><p>${esc(log.user_id||'anonymous')} · ${esc(timeText(log.created_at))} · ${esc(log.request_id||'no-request')}</p></button>`;
}
function rowPrimaryValue(rows){
  const row=(rows||[])[0]||{};
  const keys=Object.keys(row).filter(k=>k!=='error');
  return keys.length?row[keys[0]]:'-';
}
function widgetHasError(w){return (w.rows||[]).some(r=>r&&r.error)}
function widgetErrorText(w){return ((w.rows||[]).find(r=>r&&r.error)||{}).error||'Widget query failed'}
function widgetChartType(w){return (w.chart_spec&&w.chart_spec.chart_type)||w.widget_type||'chart'}
function widgetTypeLabel(w){
  return ({metric_card:'指标卡',bar:'柱状图',line:'趋势图',table:'明细表'}[widgetChartType(w)]||displayValue(widgetChartType(w)));
}
function panelSummary(panel){
  const widgets=panel.widgets||[];
  const datasetsUsed=[...new Set(widgets.map(w=>w.dataset_id).filter(Boolean))];
  return {
    widgetCount:widgets.length,
    failed:widgets.filter(widgetHasError).length,
    metricWidgets:widgets.filter(w=>w.widget_type==='metric_card').length,
    sqlWidgets:widgets.filter(w=>w.query_sql).length,
    datasetsUsed,
    chartTypes:topCounts(widgets.map(w=>({type:widgetChartType(w)})),'type',5)
  };
}
function panelCockpit(panel){
  const s=panelSummary(panel);
  const freshness=timeText(panel.updated_at||panel.created_at);
  const health=s.failed?`${s.failed} 个异常`:'全部正常';
  return `<div class="panel-cockpit">
    ${metricCard('Widget',s.widgetCount,'当前面板物化单元')}
    ${metricCard('指标卡',s.metricWidgets,'首屏关键经营指标')}
    ${metricCard('SQL 物化',s.sqlWidgets,'均经 SQL Guard 执行')}
    ${metricCard('数据集',s.datasetsUsed.length,'涉及 '+(s.datasetsUsed.map(datasetName).join(' / ')||'暂无'))}
    <div class="panel-health ${s.failed?'warn':'ok'}"><span>运行状态</span><b>${esc(health)}</b><p>${esc(freshness)} 更新 · ${displayValue(panel.status||'draft')}</p></div>
    <div class="panel-health"><span>图表结构</span><div class="widget-type-strip">${s.chartTypes.length?s.chartTypes.map(([k,v])=>`<i>${esc(widgetTypeLabel({widget_type:k,chart_spec:{chart_type:k}}))}<b>${esc(v)}</b></i>`).join(''):'<em>暂无 Widget</em>'}</div></div>
  </div>`;
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
function agentOptions(type){return agents.filter(a=>!type || a.type===type).map(a=>`<option value="${esc(a.id)}">${esc(a.name)}</option>`).join('')}
function datasetOptions(selected=''){return datasets.map(d=>`<option value="${esc(d.id)}" ${d.id===selected?'selected':''}>${esc(d.name)}</option>`).join('')}
function metricOptions(selected='', datasetId=''){
  return metrics.filter(m=>!datasetId || m.dataset_id===datasetId).map(m=>`<option value="${esc(m.id)}" ${m.id===selected?'selected':''}>${esc(m.name)}</option>`).join('');
}
const sampleSqlByDataset={
  dataset_orders:'SELECT channel, SUM(revenue) AS revenue FROM sales_orders GROUP BY channel ORDER BY revenue DESC LIMIT 10',
  dataset_business_daily:'SELECT region, SUM(revenue) AS revenue, AVG(risk_score) AS risk_score FROM business_metrics_daily GROUP BY region ORDER BY revenue DESC LIMIT 10',
  dataset_campaigns:'SELECT channel, SUM(spend) AS spend, SUM(revenue) AS revenue FROM marketing_campaigns GROUP BY channel ORDER BY revenue DESC LIMIT 10',
  dataset_products:'SELECT category, COUNT(*) AS product_count, AVG(price) AS avg_price FROM product_catalog GROUP BY category ORDER BY product_count DESC LIMIT 10',
  dataset_tickets:'SELECT root_cause, COUNT(*) AS ticket_count FROM support_tickets GROUP BY root_cause ORDER BY ticket_count DESC LIMIT 10'
};
function defaultQueryDataset(){return datasets.find(d=>d.id==='dataset_orders')?.id || datasets[0]?.id || ''}
function sampleSqlForDataset(id){const ds=datasets.find(d=>d.id===id); return sampleSqlByDataset[id] || `SELECT * FROM ${ds?.physical_table||'sales_orders'} LIMIT 20`}
function syncWorkbenchSql(){const q=document.getElementById('qDataset'), sql=document.getElementById('qSql'); if(q&&sql) sql.value=sampleSqlForDataset(q.value)}
function pageCommandDefinitions(){
  return [
    ['dashboard','总览','查看控制塔、运营闭环和关键状态','控制塔 首页 overview dashboard'],
    ['agents','Agent Studio','浏览 Agent、Adapter、风险和试用入口','agent studio adapter'],
    ['chat','智能问数','进入会话式问数、工具模式和 Trace 证据','chat 问数 data agent'],
    ['analysis','深度研究','创建研究任务、审批计划并生成报告草稿','analysis 研究 report'],
    ['panels','分析面板','打开物化经营面板和 Widget 结果','panel dashboard widgets'],
    ['dataops','数据能力','查看数据目录、SQL Workbench、画像和质量规则','dataset sql workbench data quality'],
    ['semantic','语义中心','治理术语、指标口径、查询模板和覆盖率','semantic terms metrics templates'],
    ['codex','Codex 运行台','创建、审批、派发 Codex 工程任务','codex cli sdk task'],
    ['reports','报告中心','查看报告资产、复核和发布状态','reports review publish'],
    ['knowledge','知识库','查看知识库、版本和绑定入口','knowledge kb rag'],
    ['evals','评测中心','运行评测集并查看回归结果','eval tests regression'],
    ['audit','审计日志','查看登录、问数、审批和派发审计','audit logs trace'],
    ['ops','Ops 控制面','查看 HFS 健康、只读诊断入口和运行态摘要','ops hfs health metrics errors persistence'],
    ['admin','Admin 控制面','查看管理员用户、角色、配置、平台统计和审计事件','admin users roles config stats audit']
  ].map(([page,title,description,keywords])=>({kind:'page',title,description,keywords,page,run:()=>showPage(page)}));
}
function commandHaystack(item){
  return [item.kind,item.title,item.description,item.keywords,item.id,item.name,item.code].filter(Boolean).join(' ').toLowerCase();
}
function commandMatch(item,q){
  if(!q) return true;
  return commandHaystack(item).includes(q.toLowerCase());
}
function askGlobalQuery(q){
  showPage('chat');
  setTimeout(()=>{
    const input=document.getElementById('chatInput');
    if(!input) return;
    if(q) input.value=q;
    q ? sendChat() : input.focus();
  },60);
}
function whenElementReady(id,fn,attempts=24){
  const el=document.getElementById(id);
  if(el){ fn(el); return; }
  if(attempts>0) setTimeout(()=>whenElementReady(id,fn,attempts-1),60);
}
function setChatDraft(prompt, agentId='', datasetId=''){
  showPage('chat');
  whenElementReady('chatInput',(input)=>{
    const agent=document.getElementById('chatAgent');
    if(agentId&&agent&&[...agent.options].some(o=>o.value===agentId)) agent.value=agentId;
    const dataset=document.getElementById('chatDataset');
    if(datasetId&&dataset&&[...dataset.options].some(o=>o.value===datasetId)) dataset.value=datasetId;
    input.value=prompt;
    syncChatContextBar();
    input.focus();
  });
}
function setAnalysisDraft(prompt, agentId=''){
  showPage('analysis');
  whenElementReady('analysisQuestion',(input)=>{
    const agent=document.getElementById('analysisAgent');
    if(agentId&&agent&&[...agent.options].some(o=>o.value===agentId)) agent.value=agentId;
    input.value=prompt;
    input.focus();
  });
}
function setCodexDraft(title,prompt){
  showPage('codex');
  whenElementReady('codexPrompt',(promptInput)=>{
    const titleInput=document.getElementById('codexTitle');
    if(titleInput) titleInput.value=title;
    promptInput.value=prompt;
    promptInput.focus();
  });
}
function openAuditFiltered(query){
  showPage('audit');
  whenElementReady('auditSearch',(input)=>{
    input.value=query;
    refreshAuditView();
    input.focus();
  });
}
function openSemanticFiltered(q='',domain=''){
  semanticFilterState={q,domain};
  showPage('semantic');
}
function openRelatedResource(type='',id=''){
  const t=String(type||'');
  if(t.includes('report')){ showPage('reports'); if(id) setTimeout(()=>openReportDetail(id,null),140); return; }
  if(t.includes('knowledge')){ showPage('knowledge'); if(id) setTimeout(()=>selectKnowledgeBase(id),140); return; }
  if(t.includes('semantic')){ openSemanticFiltered(id); return; }
  if(t.includes('dataset')||t.includes('data_source')){ showPage('dataops'); if(id) setTimeout(()=>openDatasetDetail(id,null),140); return; }
  if(t.includes('agent')){ showPage('agents'); if(id) setTimeout(()=>openAgentDetail(id),140); return; }
  if(t.includes('task')){ showPage('analysis'); return; }
  if(t.includes('eval')){ showPage('evals'); return; }
  showPage('dashboard');
}
function contextActionStrip(actions=[]){
  const items=actions.filter(Boolean);
  if(!items.length) return '';
  return `<div class="context-actions">${items.map(a=>`<button class="${esc(a.cls||'report-action')}" onclick="${a.onclick}">${esc(a.label)}</button>`).join('')}</div>`;
}
function openAgentCommand(agentId){
  showPage('chat');
  setTimeout(()=>{
    const select=document.getElementById('chatAgent');
    if(select) select.value=agentId;
    syncChatContextBar();
    document.getElementById('chatInput')?.focus();
  },80);
}
function openDatasetCommand(datasetId){
  showPage('dataops');
  setTimeout(()=>{
    const btn=document.querySelector('#page-dataops .tabs button[data-tab="profile"]');
    dataTab('profile',btn);
    setTimeout(()=>{
      const select=document.getElementById('profileDataset');
      if(select) select.value=datasetId;
    },60);
  },80);
}
function openMetricCommand(metric){
  showPage('chat');
  setTimeout(()=>{
    const input=document.getElementById('chatInput');
    if(input){input.value=`解释${metric.name||metric.code||'这个指标'}的业务口径和可用数据集`;sendChat();}
  },80);
}
function openReportCommand(reportId){
  reportFilterState={q:'',status:'all',type:'all'};
  showPage('reports');
  setTimeout(()=>openReportDetail(reportId,null),180);
}
function openKnowledgeCommand(kbId){
  knowledgeFilterState={q:'',backend:'all',type:'all'};
  showPage('knowledge');
  setTimeout(()=>selectKnowledgeBase(kbId),180);
}
function openSessionCommand(sessionId){
  showPage('chat');
  setTimeout(()=>loadChatSession(sessionId),180);
}
function buildCommandItems(q){
  const items=[];
  if(q) items.push({kind:'ask',title:'向 Data Agent 提问',description:q,keywords:'ask chat question',run:()=>askGlobalQuery(q)});
  items.push(...pageCommandDefinitions());
  items.push(...agents.map(a=>({kind:'agent',title:a.name,description:`试用 ${displayValue(a.type)} · ${displayValue(a.risk_level||'low')}`,keywords:[a.id,a.type,a.description,a.adapter_id].join(' '),run:()=>openAgentCommand(a.id)})));
  items.push(...datasets.map(d=>({kind:'dataset',title:d.name,description:`打开数据画像 · ${d.physical_table||d.id}`,keywords:[d.id,d.business_domain,d.description,d.data_classification].join(' '),run:()=>openDatasetCommand(d.id)})));
  items.push(...metrics.map(m=>({kind:'metric',title:m.name,description:`解释指标口径 · ${m.code||m.id}`,keywords:[m.id,m.code,m.formula,m.dataset_id].join(' '),run:()=>openMetricCommand(m)})));
  items.push(...knowledgeBasesCache.slice(0,80).map(k=>({kind:'knowledge',title:k.name||k.id,description:`打开知识库 · ${displayValue(k.backend_type||'mock')} · ${displayValue(k.type||'document')}`,keywords:[k.id,k.name,k.backend_type,k.type,k.adapter_id,k.description].join(' '),run:()=>openKnowledgeCommand(k.id)})));
  items.push(...reportsCache.slice(0,80).map(r=>({kind:'report_asset',title:r.title||r.id,description:`打开报告 Canvas · ${reportTypeLabel(r.report_type)} · ${displayValue(r.status||'draft')}`,keywords:[r.id,r.report_type,r.status,r.owner_id,r.agent_id,r.created_at,r.updated_at].join(' '),run:()=>openReportCommand(r.id)})));
  items.push(...chatSessions.slice(0,80).map(s=>({kind:'session',title:sessionTitle(s),description:`恢复会话 · ${displayValue(s.status||'active')} · ${timeText(s.updated_at)}`,keywords:[s.id,s.title,s.agent_id,s.status,s.created_at,s.updated_at].join(' '),run:()=>openSessionCommand(s.id)})));
  const prompts=['本月收入最高的渠道有哪些？','按区域统计本月收入','客户工单根因分布是什么？','解释收入指标口径','给我生成一个经营总览面板','帮我创建一个 Codex 任务，开发面板导出功能'];
  items.push(...prompts.map(p=>({kind:'prompt',title:p,description:'推荐问题',keywords:'prompt question sample',run:()=>askGlobalQuery(p)})));
  return items.filter(item=>commandMatch(item,q)).slice(0,12);
}
function renderCommandMenu(){
  const input=document.getElementById('globalSearch'), menu=document.getElementById('commandMenu');
  if(!input||!menu||document.getElementById('app')?.classList.contains('hidden')) return;
  if(!commandAssetsLoaded) refreshCommandAssets().then(()=>document.activeElement===input&&renderCommandMenu()).catch(()=>{});
  const q=input.value.trim();
  commandItems=buildCommandItems(q);
  commandIndex=0;
  input.setAttribute('aria-expanded','true');
  menu.classList.remove('hidden');
  menu.innerHTML=`<div class="command-head"><b>全局指挥入口</b><span>${commandAssetsLoaded?'页面 / Agent / 报告 / 会话':'正在同步资产'}</span></div>${commandItems.length?commandItems.map((item,i)=>`<button role="option" aria-selected="${i===commandIndex}" class="command-item ${i===commandIndex?'active':''}" onmousedown="event.preventDefault()" onclick="runCommandItem(${i})"><span>${esc(displayValue(item.kind))}</span><div><b>${esc(item.title)}</b><p>${esc(item.description||'')}</p></div></button>`).join(''):emptyState('没有匹配结果','换一个页面、Agent、报告、会话或业务问题试试。')}`;
}
function updateCommandActive(){
  document.querySelectorAll('#commandMenu .command-item').forEach((b,i)=>{
    b.classList.toggle('active',i===commandIndex);
    b.setAttribute('aria-selected',String(i===commandIndex));
  });
}
function hideCommandMenu(){
  const input=document.getElementById('globalSearch'), menu=document.getElementById('commandMenu');
  if(input) input.setAttribute('aria-expanded','false');
  if(menu) menu.classList.add('hidden');
}
function runCommandItem(index=commandIndex){
  const item=commandItems[index];
  hideCommandMenu();
  if(item){item.run(); return;}
  globalJump();
}
function handleGlobalSearchKey(e){
  if(e.key==='Escape'){hideCommandMenu();return;}
  if(e.key==='ArrowDown'){e.preventDefault(); if(!commandItems.length) renderCommandMenu(); commandIndex=Math.min(commandItems.length-1,commandIndex+1); updateCommandActive(); return;}
  if(e.key==='ArrowUp'){e.preventDefault(); commandIndex=Math.max(0,commandIndex-1); updateCommandActive(); return;}
  if(e.key==='Enter'){e.preventDefault(); commandItems.length?runCommandItem(commandIndex):globalJump();}
}
function setActiveNav(page){
  document.querySelectorAll('#nav button').forEach(b=>{
    const active=b.dataset.page===page;
    b.classList.toggle('active',active);
    if(active) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current');
  });
  const titles={dashboard:'总览',agents:'Agent Studio',chat:'智能问数',analysis:'深度研究',panels:'分析面板',dataops:'数据能力',semantic:'语义中心',codex:'Codex 运行台',reports:'报告中心',knowledge:'知识库',evals:'评测中心',audit:'审计日志',ops:'Ops 控制面',admin:'Admin 控制面'};
  document.getElementById('pageTitle').innerText=titles[page]||page;
}
function syncSidebarA11y(){
  const app=document.getElementById('app'); if(!app) return;
  const open=app.classList.contains('sidebar-open');
  const mobile=window.matchMedia('(max-width: 760px)').matches;
  const btn=document.getElementById('mobileMenu');
  const sidebar=document.querySelector('.sidebar');
  if(!mobile && open) app.classList.remove('sidebar-open');
  if(btn) btn.setAttribute('aria-expanded',String(mobile && open));
  if(sidebar){
    sidebar.setAttribute('aria-hidden',String(mobile && !open));
    sidebar.toggleAttribute('inert',mobile && !open);
  }
}
function sidebarFocusables(){
  return Array.from(document.querySelectorAll('.sidebar button,.sidebar [href],.sidebar input,.sidebar select,.sidebar textarea,.sidebar [tabindex]:not([tabindex="-1"])'))
    .filter(el=>!el.disabled && el.offsetParent!==null);
}
function toggleSidebar(force){
  const app=document.getElementById('app'); if(!app) return;
  const open=typeof force==='boolean'?force:!app.classList.contains('sidebar-open');
  const btn=document.getElementById('mobileMenu');
  if(open && btn) lastSidebarTrigger=btn;
  app.classList.toggle('sidebar-open',open);
  syncSidebarA11y();
  if(open && window.matchMedia('(max-width: 760px)').matches) requestAnimationFrame(()=>sidebarFocusables()[0]?.focus());
  if(!open && lastSidebarTrigger && window.matchMedia('(max-width: 760px)').matches) lastSidebarTrigger.focus();
}
document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='k'){
    e.preventDefault();
    const input=document.getElementById('globalSearch');
    input?.focus();
    renderCommandMenu();
    return;
  }
  if(e.key==='Escape' && chatSending){
    stopChatGeneration();
    return;
  }
  if(e.key==='Escape') toggleSidebar(false);
  const app=document.getElementById('app');
  if(e.key!=='Tab' || !app?.classList.contains('sidebar-open') || !window.matchMedia('(max-width: 760px)').matches) return;
  const focusables=sidebarFocusables();
  if(!focusables.length) return;
  const first=focusables[0], last=focusables[focusables.length-1];
  if(e.shiftKey && document.activeElement===first){e.preventDefault(); last.focus();}
  else if(!e.shiftKey && document.activeElement===last){e.preventDefault(); first.focus();}
});
document.addEventListener('click',e=>{
  if(!e.target.closest('.top-actions')) hideCommandMenu();
});
window.addEventListener('resize',syncSidebarA11y);
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
function initialPageFromLocation(){
  const valid=new Set(['dashboard','agents','chat','analysis','panels','dataops','semantic','codex','reports','knowledge','evals','audit','ops','admin']);
  const params=new URLSearchParams(window.location.search);
  const requested=params.get('page');
  if(requested && valid.has(requested)) return requested;
  if(window.location.pathname.startsWith('/_admin')) return 'admin';
  return 'dashboard';
}
async function bootstrap(){await refreshCatalog(); await refreshCommandAssets(); showPage(initialPageFromLocation());}
function resetPageScroll(){
  document.querySelector('.main')?.scrollTo({top:0,left:0});
  window.scrollTo({top:0,left:0});
}
function showPage(name){
  activePage=name; setActiveNav(name);
  toggleSidebar(false);
  document.querySelectorAll('.page').forEach(p=>p.classList.add('hidden'));
  const page=document.getElementById('page-'+name);
  if(!page.innerHTML.trim()) page.innerHTML=loadingState();
  page.classList.remove('hidden');
  resetPageScroll();
  const renderers={dashboard:renderDashboard,agents:renderAgents,chat:renderChat,analysis:renderAnalysis,panels:renderPanels,dataops:renderDataOps,semantic:renderSemantic,codex:renderCodex,reports:renderReports,knowledge:renderKnowledge,evals:renderEvals,audit:renderAudit,ops:renderOps,admin:renderAdmin};
  const rendered=renderers[name] && renderers[name]();
  Promise.resolve(rendered).finally(()=>requestAnimationFrame(resetPageScroll));
}
function globalJump(){const q=(document.getElementById('globalSearch').value||'').trim(); hideCommandMenu(); askGlobalQuery(q)}
function continuationTimestamp(item){
  return item.updated_at||item.created_at||'';
}
function dashboardContinuationItems(){
  const sessions=(chatSessions||[]).slice(0,10).map(s=>({
    kind:'session',
    id:s.id,
    title:sessionTitle(s),
    detail:`${displayValue(s.status||'active')} · ${s.agent_id||'auto'}`,
    time:continuationTimestamp(s),
    run:()=>openSessionCommand(s.id)
  }));
  const reports=(reportsCache||[]).slice(0,10).map(r=>({
    kind:'report_asset',
    id:r.id,
    title:r.title||r.id,
    detail:`${reportTypeLabel(r.report_type)} · ${displayValue(r.status||'draft')}`,
    time:continuationTimestamp(r),
    run:()=>openReportCommand(r.id)
  }));
  return [...sessions,...reports]
    .sort((a,b)=>(Date.parse(b.time)||0)-(Date.parse(a.time)||0))
    .slice(0,6);
}
function dashboardContinuationCard(item){
  const label=item.kind==='session'?'恢复':'打开';
  return `<article class="continuation-card" data-continuation-kind="${esc(item.kind)}" data-continuation-id="${esc(item.id)}">
    <div><span>${esc(displayValue(item.kind))}</span><b>${esc(item.title)}</b><p>${esc(item.detail)} · ${esc(timeText(item.time))}</p></div>
    <button class="report-action" onclick="${item.kind==='session'?`openSessionCommand('${jsArg(item.id)}')`:`openReportCommand('${jsArg(item.id)}')`}">${label}</button>
  </article>`;
}
function dashboardContinuationPanel(){
  const items=dashboardContinuationItems();
  return `<div class="dashboard-continuation section-gap">
    <section class="continuation-panel"><div class="section-title"><div><h2>继续上次工作</h2><p>最近会话和报告资产直接回到上下文，避免在多个页面里重新寻找。</p></div>${tag(`${items.length} items`)}</div>${items.length?`<div class="continuation-list">${items.map(dashboardContinuationCard).join('')}</div>`:emptyState('暂无可恢复上下文','发起问数或保存报告后，这里会显示最近工作。')}</section>
    <aside class="command-hint-card"><span>COMMAND</span><b>Ctrl/⌘ K</b><p>搜索页面、Agent、数据集、指标、报告和会话，直接进入下一步工作。</p><button class="secondary" onclick="event.stopPropagation();document.getElementById('globalSearch')?.focus();renderCommandMenu()">打开全局指挥入口</button></aside>
  </div>`;
}

async function renderDashboard(){
  const [stats,codexDiag,tasks]=await Promise.all([
    api('/api/admin/stats').catch(()=>({counts:{agents:agents.length,datasets:datasets.length,metrics:metrics.length}})),
    api('/api/codex/diagnostics').catch(()=>({})),
    api('/api/tasks').catch(()=>[])
  ]);
  const counts=stats.counts||stats;
  const p=document.getElementById('page-dashboard');
  const metricOrder=[
    ['agents','可用 Agent','覆盖问数、研究、治理、报告与工程派发'],
    ['sessions','会话','当前演示环境累计会话'],
    ['tasks','工程任务','Codex 任务池'],
    ['traces','Trace','可追溯执行链路'],
    ['reports','报告','AI 生成报告资产'],
    ['eval_sets','评测集','回归与质量评估'],
    ['feedback','反馈','业务侧闭环输入'],
    ['audit_logs','审计','关键动作留痕']
  ];
  const route=['业务提问','总控路由','SQL Guard','数据/知识/Codex','Trace 证据','审计留痕'];
  const sampleQuestions=dashboardPromptExamples();
  p.innerHTML=`${pageHeader('独立数据智能体控制塔','把问数、数据治理、深度研究、报告产出和 Codex 工程任务放在同一个可审计工作台里。',['RBAC','SQL Guard','Trace','Approval Flow'])}
  <div class="dashboard-hero">
    <div>
      <div class="eyebrow">OPERATING LOOP</div>
      <h2>业务问题进入 Agent Gateway，结果回到 Trace 与审计闭环。</h2>
      <p>面向业务用户保留答案、图表和建议；面向数据与平台人员暴露 SQL、工具调用、审批和执行证据。</p>
      <div class="hero-actions"><button onclick="showPage('chat')">开始问数</button><button class="secondary" onclick="showPage('dataops')">查看数据资产</button><button class="ghost" onclick="showPage('codex')">进入 Codex 运行台</button></div>
    </div>
    <div class="control-loop">${route.map((x,i)=>`<div class="loop-step"><span>${i+1}</span>${esc(x)}</div>`).join('')}</div>
  </div>
  <div class="dashboard-composer section-gap">
    <div class="section-title"><div><h2>工作台入口</h2><p>把 ChatGPT 式的一句话任务分发到问数、深度研究、面板或 Codex，但每条链路仍回到 Trace 与审计。</p></div>${tag('composer')}</div>
    <div class="dashboard-composer-row"><textarea id="dashboardPrompt" rows="2" placeholder="输入一个业务问题、研究目标、面板需求或工程改造任务">本月收入最高的渠道有哪些？</textarea><div><label class="field-label" for="dashboardTarget">目标</label><select id="dashboardTarget"><option value="chat">智能问数</option><option value="analysis">深度研究</option><option value="panel">分析面板</option><option value="codex">Codex 任务</option></select><button onclick="launchDashboardIntent()">开始</button></div></div>
    <div class="prompt-strip">${sampleQuestions.map(dashboardPromptButton).join('')}</div>
  </div>
  ${dashboardContinuationPanel()}
  <div class="dashboard-task-grid section-gap">
    ${taskQueuePanel(tasks,{title:'最近任务队列',description:'把深度研究、报告和异步任务放回控制塔，点击任务即可继续查看结果与 Trace。',detailId:'dashboardTaskDetail',traceHandler:'openDashboardTrace',limit:6})}
    ${traceDrawer('dashboardTraceBox','任务证据','从最近任务直接复核计划、SQL、工具调用和输出 Trace。')}
  </div>
  <div class="metric-grid">${metricOrder.map(([k,label,note])=>metricCard(label,counts[k]??0,note)).join('')}</div>
  <div class="grid3 section-gap">
    ${card('Agent 套件', `<p>内置 ${agents.length} 个 Agent，覆盖总控路由、问数、工单归因、深度研究、风险识别、数据画像、数据质量、语义治理、面板生成、报告和 Codex 工程 Agent。</p><div>${tag('Agent Gateway')}${tag('Trace')}${tag('RBAC')}</div>`)}
    ${card('数据能力', `<p>数据目录、指标语义、查询模板、只读 SQL Workbench、数据画像、业务规则和 CSV 导入统一进入治理工作台。</p><div>${tag('SQL Guard','green')}${tag('DQM')}${tag('Semantic')}</div>`)}
    ${card('Codex 运行状态', `<p>CLI：${codexDiag.cli?.path?esc(codexDiag.cli.path):'未检测'}<br/>SDK：${codexDiag.sdk?.module_found?'已检测':'未检测'}<br/>默认模式：${esc(codexDiag.mode_default||'-')}</p><div>${statusTag(codexDiag.mode_default||'mock')}${tag('approval','amber')}${tag('handoff')}</div>`)}
  </div>
  <div class="grid2 section-gap">
    <div class="card action-card"><h3>推荐验证问题</h3><div class="prompt-grid">${sampleQuestions.map(q=>`<button class="prompt-pill" onclick="showPage('chat');setTimeout(()=>askPreset('${jsArg(q)}'),40)">${esc(q)}</button>`).join('')}</div></div>
    <div class="card"><h3>关键验证路径</h3><div class="stepper">${['总控 Agent 提问','查看 SQL / Trace','打开分析面板','运行数据质量','创建 Codex 工程任务','审批并派发'].map(x=>`<span>${esc(x)}</span>`).join('')}</div></div>
  </div>`;
}

async function renderAgents(){
  const groups={}; agents.forEach(a=>{groups[a.type]=groups[a.type]||[];groups[a.type].push(a)});
  const filtered=agents.filter(agentMatches);
  const highRisk=agents.filter(a=>a.risk_level==='high').length;
  activeAgentDetailId=activeAgentDetailId||filtered[0]?.id||agents[0]?.id||'';
  document.getElementById('page-agents').innerHTML=`${pageHeader('Agent Studio','按能力域查看内置 Agent、风险等级、Adapter 绑定和可试用入口。',['Gateway','Adapters','RBAC'])}
  <div class="metric-grid tight">${metricCard('Agent 总数',agents.length,'当前可用能力单元')}${metricCard('能力类型',Object.keys(groups).length,'路由、问数、研究、治理等')}${metricCard('高风险 Agent',highRisk,'需保留审批和审计')}${metricCard('外部 Adapter',agents.filter(a=>a.adapter_id).length,'可接入 Dify / RAGFlow 等')}</div>
  <div class="agent-studio section-gap">
    <section class="agent-directory">
      <div class="section-title"><div><h2>能力目录</h2><p>按 Agent 类型组织，选择一个能力后在右侧查看版本、知识绑定和可用动作。</p></div>${tag(`${agents.length} agents`)}</div>
      ${agentFilterBar(filtered)}
      <div id="agentDirectoryList" class="agent-mini-list"></div>
    </section>
    <aside class="agent-inspector" id="agentDetail">${emptyState('正在加载 Agent','选择 Agent 后显示版本、知识绑定和试用入口。')}</aside>
  </div>`;
  renderAgentDirectory();
  if(activeAgentDetailId) openAgentDetail(activeAgentDetailId).catch(()=>{});
}
async function openAgentDetail(id){
  activeAgentDetailId=id;
  document.querySelectorAll('.agent-mini-card').forEach(card=>card.classList.toggle('active',card.dataset.agentId===id));
  const box=document.getElementById('agentDetail');
  if(box) box.innerHTML=inlineLoading('正在读取 Agent 详情');
  const a=await api('/api/agents/'+id);
  if(!box) return;
  const canDispatch=a.risk_level==='high'||a.require_human_approval;
  box.innerHTML=`<div class="agent-inspector-panel"><div class="card-heading"><div><h3>${esc(a.name)}</h3><p class="muted">${esc(a.description||'')}</p></div><div>${tag(a.type||'agent')}${statusTag(a.status)}${statusTag(a.risk_level)}</div></div>
  ${stateBanner(canDispatch?'warn':'success',canDispatch?'需要人工审批':'可直接试用',canDispatch?'高风险或要求人工审批的 Agent 只通过受控流程执行。':'可从智能问数入口试用，并保留 Trace。',[a.id,a.adapter_id||'no-adapter'])}
  <div class="agent-inspector-actions"><button onclick="showPage('chat');setTimeout(()=>{document.getElementById('chatAgent').value='${jsArg(a.id)}';syncChatContextBar()},80)">在问数中试用</button><button class="secondary" onclick="showPage('analysis');setTimeout(()=>{const s=document.getElementById('analysisAgent'); if(s&&[...s.options].some(o=>o.value==='${jsArg(a.id)}')) s.value='${jsArg(a.id)}'},80)">用于研究</button><button class="ghost" onclick="showPage('audit')">查看审计</button></div>
  <h4>版本记录</h4>${renderTable(a.versions||[],{columns:['version','backend_type','adapter_id','status','created_at'],limit:20,compact:true})}
  <h4>知识绑定</h4>${renderTable(a.knowledge_bindings||[],{columns:['name','backend_type','adapter_id','status'],limit:20,compact:true})}</div>`;
}

function renderChat(){
  const prompts=['本月收入最高的渠道有哪些？','按区域统计本月收入','近三个月收入趋势如何？','客户工单根因分布是什么？','解释收入指标口径','帮我创建一个 Codex 任务，开发面板导出功能'];
  document.getElementById('page-chat').innerHTML=`${pageHeader('智能问数','像 ChatGPT 一样从一个会话入口完成提问、工具选择、上下文绑定和证据复核。',['Sessions','Tools','Trace'])}
  <div class="assistant-shell">
    <aside class="session-rail">
      <button class="new-chat" onclick="startNewChat()">新建对话</button>
      <div class="session-controls">
        <div class="rail-title">会话库</div>
        <input id="sessionSearch" placeholder="搜索会话标题或消息内容" value="${esc(chatSessionFilter.q)}" oninput="chatSessionFilter.q=this.value;renderSessionList()" aria-label="搜索会话标题或消息内容"/>
        <div class="session-filter" role="tablist" aria-label="会话状态">
          <button data-status="active" class="${chatSessionFilter.status==='active'?'active':''}" onclick="setSessionFilter('active',this)">活跃</button>
          <button data-status="project" class="${chatSessionFilter.status==='project'?'active':''}" onclick="setSessionFilter('project',this)">项目</button>
          <button data-status="archived" class="${chatSessionFilter.status==='archived'?'active':''}" onclick="setSessionFilter('archived',this)">归档</button>
          <button data-status="all" class="${chatSessionFilter.status==='all'?'active':''}" onclick="setSessionFilter('all',this)">全部</button>
        </div>
      </div>
      <div id="chatSessionList">${inlineLoading('正在读取会话')}</div>
      <div class="context-card">
        <b>工作上下文</b>
        <label class="field-label" for="chatAgent">Agent</label><select id="chatAgent" onchange="detachChatSessionForAgent();syncChatContextBar()">${agentOptions()}</select>
        <label class="field-label" for="chatDataset">数据集</label><select id="chatDataset" onchange="syncChatContextBar()"><option value="">自动选择</option>${datasetOptions()}</select>
        <label class="field-label" for="traceDepth">证据深度</label><select id="traceDepth" onchange="syncChatContextBar()"><option value="standard">标准 Trace</option><option value="full">完整证据</option></select>
      </div>
      ${renderContextPackPanel()}
    </aside>
    <section class="chat-stage">
      <div class="chat-stage-head"><div><span>Data Agent</span><b id="chatSessionTitle">新对话</b></div><div class="chat-stage-actions"><div class="tool-strip" id="toolMode"><button class="active" data-mode="auto" onclick="setToolMode('auto',this)">自动</button><button data-mode="analysis" onclick="setToolMode('analysis',this)">分析</button><button data-mode="sql" onclick="setToolMode('sql',this)">SQL</button><button data-mode="codex" onclick="setToolMode('codex',this)">Codex</button></div><div class="brief-strip" aria-label="会话 Brief 操作"><button onclick="writeChatBriefToCanvas(this)">生成 Brief</button><button onclick="copyChatBrief(this)">复制 Brief</button><button onclick="downloadChatBriefMarkdown(this)">下载 Brief</button></div></div></div>
      <div id="chatMessages" class="chat-thread">${chatEmptyState()}</div>
      <div class="composer-card">
        <div id="chatContextBar">${renderChatContextBar()}</div>
        <div class="composer-tools" aria-label="上下文快捷动作">
          <button type="button" onclick="runChatQuickTool('metric')"><b>解释指标</b><span>口径和可追问</span></button>
          <button type="button" onclick="runChatQuickTool('chart')"><b>生成图表</b><span>趋势或分布</span></button>
          <button type="button" onclick="runChatQuickTool('asset')"><b>打开数据资产</b><span>字段和画像</span></button>
          <button type="button" onclick="runChatQuickTool('research')"><b>转深度研究</b><span>计划和报告</span></button>
          <button type="button" onclick="runChatQuickTool('codex')"><b>创建 Codex 任务</b><span>工程闭环</span></button>
        </div>
        <div class="prompt-list compact">${prompts.map(promptButton).join('')}</div>
        <div class="composer-row">
          <textarea id="chatInput" rows="2" placeholder="询问数据，或输入 / 打开工具" oninput="renderComposerCommandMenu()" onkeydown="handleComposerKey(event)"></textarea>
          <button id="chatSendButton" onclick="sendChat(this)" aria-label="发送消息">发送</button><button id="chatStopButton" class="stop-chat hidden" onclick="stopChatGeneration(this)" aria-label="停止生成">停止</button>
          <div id="composerCommandMenu" class="composer-command-menu hidden" role="listbox" aria-label="Composer 工具菜单"></div>
        </div>
        <div class="composer-meta"><span>Enter 发送，Shift+Enter 换行，/ 打开工具</span><span>SQL Guard / RBAC / Trace 始终保留</span></div>
      </div>
    </section>
    <aside class="evidence-drawer trace-pane">
      <div class="pane-title"><span>Trace</span><div><h2>证据</h2><p>SQL、工具调用和执行步骤在这里复核。</p></div></div>
      <div id="traceBox">${emptyState('暂无 Trace','发送问题后会显示执行状态、SQL、工具调用与步骤输出。')}</div>
      ${renderChatCanvas()}
    </aside>
  </div>`;
  const router=agents.find(a=>a.id==='agent_router'); if(router) document.getElementById('chatAgent').value=router.id;
  syncChatContextBar();
  syncChatBriefControls();
  refreshChatSessions().catch(()=>{document.getElementById('chatSessionList').innerHTML=emptyState('会话读取失败','仍可直接开始新对话。')});
}
function chatEmptyState(){
  return `<div class="chat-welcome"><div class="assistant-mark">DA</div><h2>今天要分析什么？</h2><p>选择数据上下文后直接提问。业务答案留在中间，SQL、工具和审批证据留在右侧。</p></div>`;
}
function setToolMode(mode,btn){
  document.querySelectorAll('#toolMode button').forEach(b=>b.classList.toggle('active',b===btn||b.dataset.mode===mode));
  syncChatContextBar();
}
function chatContextSnapshot(){
  const agentId=document.getElementById('chatAgent')?.value || agents.find(a=>a.id==='agent_router')?.id || agents[0]?.id || '';
  const datasetId=document.getElementById('chatDataset')?.value || '';
  const toolMode=document.querySelector('#toolMode button.active')?.dataset.mode || 'auto';
  const evidenceDepth=document.getElementById('traceDepth')?.value || 'standard';
  return {
    agent:agents.find(a=>a.id===agentId)||{id:agentId,name:agentId||'自动路由',type:'router'},
    dataset:datasets.find(d=>d.id===datasetId)||null,
    toolMode,
    evidenceDepth
  };
}
function chatContextChip(label,value,detail='',cls=''){
  return `<span class="chat-context-chip ${esc(cls)}"><small>${esc(label)}</small><b>${esc(value)}</b>${detail?`<em>${esc(detail)}</em>`:''}</span>`;
}
function renderChatContextBar(){
  const ctx=chatContextSnapshot();
  const agentLabel=ctx.agent?.name || ctx.agent?.id || '自动路由';
  const datasetLabel=ctx.dataset?.name || '自动选择';
  const datasetDetail=ctx.dataset ? [ctx.dataset.business_domain,displayValue(ctx.dataset.data_classification||'internal')].filter(Boolean).join(' · ') : '按问题路由';
  const toolLabels={auto:'自动',analysis:'分析',sql:'SQL',codex:'Codex'};
  const depthLabels={standard:'标准 Trace',full:'完整证据'};
  return `<div class="chat-context-bar" aria-live="polite">
    ${chatContextChip('Agent',agentLabel,displayValue(ctx.agent?.type||'router'),'primary')}
    ${chatContextChip('数据集',datasetLabel,datasetDetail)}
    ${chatContextChip('工具',toolLabels[ctx.toolMode]||ctx.toolMode,'会话模式')}
    ${chatContextChip('证据',depthLabels[ctx.evidenceDepth]||ctx.evidenceDepth,'Trace')}
    ${chatContextChip('工作包',contextPackSummaryLabel(),contextPackSummaryDetail(),contextPackHasContent()?'accent':'')}
  </div>`;
}
function syncChatContextBar(){
  const box=document.getElementById('chatContextBar');
  if(box) box.innerHTML=renderChatContextBar();
}
function contextPackCounts(){
  const p=normalizeContextPack(contextPack);
  return {
    datasets:p.datasetIds.length,
    knowledge:p.knowledgeBaseIds.length,
    reports:p.reportIds.length,
    traces:p.traceIds.length,
    sessions:p.sessionIds.length,
    instructions:p.instructions.trim()?1:0,
    canvas:p.includeCanvas&&chatCanvasValue().trim()?1:0
  };
}
function contextPackSummaryLabel(){
  const counts=contextPackCounts();
  const total=counts.datasets+counts.knowledge+counts.reports+counts.traces+counts.sessions+counts.instructions+counts.canvas+(contextPack.agentId?1:0);
  return total?`${total} 项上下文`:'未捕获';
}
function contextPackSummaryDetail(){
  const counts=contextPackCounts();
  const parts=[];
  parts.push(normalizeContextPack(contextPack).memoryMode==='project'?'项目记忆':'默认记忆');
  if(counts.instructions) parts.push('指令');
  if(contextPack.agentId) parts.push('Agent');
  if(counts.datasets) parts.push(`${counts.datasets} 数据集`);
  if(counts.knowledge) parts.push(`${counts.knowledge} 知识库`);
  if(counts.reports) parts.push(`${counts.reports} 报告`);
  if(counts.traces) parts.push(`${counts.traces} Trace`);
  if(counts.canvas) parts.push('Canvas');
  if(counts.sessions) parts.push(`${counts.sessions} 会话`);
  return parts.length?parts.join(' · '):'Project-style local context';
}
function contextPackAgentName(){
  return agents.find(a=>a.id===contextPack.agentId)?.name || contextPack.agentId || '';
}
function contextPackReportTitle(id){
  const report=reportsCache.find(r=>r.id===id);
  return report ? `${report.title||id} · ${reportTypeLabel(report.report_type)}` : id;
}
function contextPackPills(){
  const p=normalizeContextPack(contextPack);
  const pills=[];
  if(p.agentId) pills.push({kind:'agent',id:p.agentId,label:'Agent',value:contextPackAgentName()});
  p.datasetIds.forEach(id=>pills.push({kind:'dataset',id,label:'数据集',value:datasetName(id)}));
  p.knowledgeBaseIds.forEach(id=>pills.push({kind:'knowledge',id,label:'知识库',value:knowledgeBaseName(id)}));
  p.reportIds.forEach(id=>pills.push({kind:'report',id,label:'报告',value:contextPackReportTitle(id)}));
  p.traceIds.forEach(id=>pills.push({kind:'trace',id,label:'Trace',value:id}));
  p.sessionIds.forEach(id=>pills.push({kind:'session',id,label:'会话',value:id}));
  return pills.length?`<div class="context-pack-pills">${pills.map(pill=>`<article class="context-pack-pill">
    <div><small>${esc(pill.label)}</small><b>${esc(short(pill.value,34))}</b></div>
    <nav aria-label="${esc(pill.label)} 操作"><button type="button" onclick="openContextPackItem('${jsArg(pill.kind)}','${jsArg(pill.id)}')">打开</button><button type="button" onclick="removeContextPackItem('${jsArg(pill.kind)}','${jsArg(pill.id)}')">移除</button></nav>
  </article>`).join('')}</div>`:`<p class="context-pack-empty">捕获当前会话或添加资产后，这里会显示 Agent、数据集、知识库、Trace、报告和会话线索。</p>`;
}
function contextPackStatusText(){
  return contextPack.updatedAt?`已更新 ${timeText(contextPack.updatedAt)} · 本地浏览器工作包`:'本地浏览器工作包 · 未写入服务端';
}
function renderContextPackPresetBar(){
  const options=contextPackPresets.map(p=>`<option value="${esc(p.id)}" ${p.id===activeContextPackPresetId?'selected':''}>${esc(p.name)} · ${esc(timeText(p.updatedAt))}</option>`).join('');
  return `<div class="context-pack-presets" aria-label="工作包预设">
    <label><span>项目预设</span><select id="contextPackPresetSelect" onchange="activeContextPackPresetId=this.value">
      <option value="">选择本地预设</option>${options}
    </select></label>
    <div>
      <button type="button" onclick="saveContextPackPreset(this)">保存</button>
      <button type="button" onclick="loadContextPackPreset()">加载</button>
      <button type="button" onclick="deleteContextPackPreset(this)">删除</button>
    </div>
  </div>`;
}
function contextPackAssetItems(){
  const q=(contextPackAssetFilterState.q||'').trim().toLowerCase();
  const type=contextPackAssetFilterState.type||'all';
  const items=[
    ...datasets.map(d=>({
      kind:'dataset',
      label:'数据集',
      id:d.id,
      title:d.name||d.id,
      detail:[d.business_domain,d.physical_table,displayValue(d.data_classification||'internal')].filter(Boolean).join(' · '),
      keywords:[d.id,d.name,d.physical_table,d.business_domain,d.description,d.data_classification].join(' ')
    })),
    ...knowledgeBasesCache.map(k=>({
      kind:'knowledge',
      label:'知识库',
      id:k.id,
      title:k.name||k.id,
      detail:[displayValue(k.backend_type||'mock'),displayValue(k.type||'document'),k.adapter_id].filter(Boolean).join(' · '),
      keywords:[k.id,k.name,k.backend_type,k.type,k.adapter_id,k.description].join(' ')
    })),
    ...reportsCache.slice(0,80).map(r=>({
      kind:'report',
      label:'报告',
      id:r.id,
      title:r.title||r.id,
      detail:[reportTypeLabel(r.report_type),displayValue(r.status||'draft'),timeText(r.updated_at||r.created_at)].filter(Boolean).join(' · '),
      keywords:[r.id,r.title,r.report_type,r.status,r.owner_id,r.agent_id,r.created_at,r.updated_at].join(' ')
    }))
  ];
  return items
    .filter(item=>(type==='all'||item.kind===type)&&(!q||[item.id,item.title,item.detail,item.keywords].join(' ').toLowerCase().includes(q)))
    .slice(0,8);
}
function contextPackAssetInPack(kind,id,pack=normalizeContextPack(contextPack)){
  if(kind==='dataset') return pack.datasetIds.includes(id);
  if(kind==='knowledge') return pack.knowledgeBaseIds.includes(id);
  if(kind==='report') return pack.reportIds.includes(id);
  return false;
}
function contextPackAssetListHtml(){
  const items=contextPackAssetItems();
  const pack=normalizeContextPack(contextPack);
  if(!items.length) return emptyState('没有匹配资产','换一个关键词或资产类型。');
  return `<div class="context-asset-list">${items.map(item=>{
    const selected=contextPackAssetInPack(item.kind,item.id,pack);
    return `<article class="context-asset-item ${selected?'selected':''}">
      <div><small>${esc(item.label)}</small><b>${esc(short(item.title,38))}</b><span>${esc(short(item.detail||item.id,54))}</span></div>
      <button class="report-action ${selected?'muted-action':''}" ${selected?'disabled':''} onclick="addContextAssetToPack('${jsArg(item.kind)}','${jsArg(item.id)}',this)">${selected?'已加入':'加入'}</button>
    </article>`;
  }).join('')}</div>`;
}
function renderContextPackAssetPicker(){
  const type=contextPackAssetFilterState.type||'all';
  return `<div class="context-pack-picker">
    <div class="context-pack-filter">
      <label><span>资产</span><input id="contextPackAssetSearch" value="${esc(contextPackAssetFilterState.q||'')}" placeholder="搜索数据集、知识库、报告" oninput="contextPackAssetFilterState.q=this.value;renderContextPackAssetList()"/></label>
      <label><span>类型</span><select id="contextPackAssetType" onchange="contextPackAssetFilterState.type=this.value;renderContextPackAssetList()">
        ${[['all','全部'],['dataset','数据集'],['knowledge','知识库'],['report','报告']].map(([value,label])=>`<option value="${value}" ${type===value?'selected':''}>${label}</option>`).join('')}
      </select></label>
    </div>
    <div id="contextPackAssetList">${contextPackAssetListHtml()}</div>
  </div>`;
}
function renderContextPackAssetList(){
  const list=document.getElementById('contextPackAssetList');
  if(list) list.innerHTML=contextPackAssetListHtml();
}
function renderContextPackPanel(){
  const active=contextPackHasContent();
  const p=normalizeContextPack(contextPack);
  return `<section id="contextPackPanel" class="context-pack-card ${active?'active':''}" aria-label="工作包">
    <div class="context-pack-head"><div><span>Context Pack</span><b>${esc(contextPack.name||'默认工作包')}</b></div>${active?tag('active','green'):tag('empty')}</div>
    ${renderContextPackPresetBar()}
    <label class="field-label" for="contextPackInstructions">工作指令</label>
    <textarea id="contextPackInstructions" rows="4" placeholder="写下这组工作要长期遵循的口径、范围或偏好。" oninput="updateContextPackInstructions(this.value)">${esc(contextPack.instructions)}</textarea>
    <div class="context-pack-memory" aria-label="工作包记忆边界">
      <span>记忆边界</span>
      <button type="button" class="${p.memoryMode==='project'?'active':''}" onclick="setContextPackMemoryMode('project')">项目内</button>
      <button type="button" class="${p.memoryMode==='default'?'active':''}" onclick="setContextPackMemoryMode('default')">默认</button>
    </div>
    <label class="context-pack-toggle"><input type="checkbox" ${p.includeCanvas?'checked':''} onchange="toggleContextPackCanvas(this.checked)"/><span>带 Canvas 草稿提问</span></label>
    ${contextPackPills()}
    ${renderContextPackAssetPicker()}
    <div class="context-pack-actions">
      <button class="report-action" onclick="captureContextPack()">捕获当前</button>
      <button class="report-action" onclick="applyContextPackToChat()">应用</button>
      <button class="report-action" onclick="writeContextPackToCanvas()">写入 Canvas</button>
      <button class="report-action ghost-tool" onclick="clearContextPack()">清空</button>
    </div>
    <small id="contextPackStatus" class="context-pack-status">${esc(contextPackStatusText())}</small>
  </section>`;
}
function syncContextPackPanel(){
  const panel=document.getElementById('contextPackPanel');
  if(panel) panel.outerHTML=renderContextPackPanel();
  syncChatContextBar();
  renderSessionList();
}
function persistContextPack(opts={}){
  contextPack=normalizeContextPack(contextPack);
  try{localStorage.setItem(CONTEXT_PACK_STORAGE_KEY,JSON.stringify(contextPack));}catch(e){}
  if(opts.render===false){
    const status=document.getElementById('contextPackStatus');
    if(status) status.innerText=opts.status||contextPackStatusText();
    syncChatContextBar();
  }else{
    syncContextPackPanel();
  }
  if(opts.toast) toast(opts.toast);
}
function selectedContextPackPreset(){
  const select=document.getElementById('contextPackPresetSelect');
  const id=select?.value || activeContextPackPresetId || '';
  return contextPackPresets.find(p=>p.id===id)||null;
}
function saveContextPackPreset(btn){
  setBusy(btn,true);
  try{
    const existing=selectedContextPackPreset();
    const baseName=existing?.name || contextPack.name || '默认工作包';
    const name=window.prompt(existing?'更新工作包预设名称':'保存工作包预设',baseName);
    if(name===null) return;
    const clean=short(name.trim(),40);
    if(!clean) return toast('预设名称不能为空');
    contextPack=normalizeContextPack(Object.assign({},contextPack,{name:clean,updatedAt:new Date().toISOString()}));
    const preset=normalizeContextPackPreset({id:existing?.id||contextPackPresetId(),name:clean,pack:contextPack,updatedAt:new Date().toISOString()});
    contextPackPresets=[preset,...contextPackPresets.filter(p=>p.id!==preset.id)].slice(0,12);
    activeContextPackPresetId=preset.id;
    persistContextPackPresets();
    persistContextPack({toast:existing?'工作包预设已更新':'工作包预设已保存'});
  }finally{
    setBusy(btn,false);
  }
}
function loadContextPackPreset(id=''){
  const targetId=id || document.getElementById('contextPackPresetSelect')?.value || activeContextPackPresetId;
  const preset=contextPackPresets.find(p=>p.id===targetId);
  if(!preset) return toast('请选择要加载的工作包预设');
  activeContextPackPresetId=preset.id;
  contextPack=normalizeContextPack(Object.assign({},preset.pack,{name:preset.name,updatedAt:new Date().toISOString()}));
  persistContextPack({toast:`已加载工作包预设：${preset.name}`});
  if(activePage==='chat') applyContextPackToChat();
}
function deleteContextPackPreset(btn){
  const preset=selectedContextPackPreset();
  if(!preset) return toast('请选择要删除的工作包预设');
  if(!window.confirm(`删除本地工作包预设“${preset.name}”？`)) return;
  setBusy(btn,true);
  try{
    contextPackPresets=contextPackPresets.filter(p=>p.id!==preset.id);
    if(activeContextPackPresetId===preset.id) activeContextPackPresetId='';
    persistContextPackPresets();
    syncContextPackPanel();
    toast('工作包预设已删除');
  }finally{
    setBusy(btn,false);
  }
}
function updateContextPackInstructions(value){
  contextPack.instructions=String(value||'').slice(0,1200);
  contextPack.updatedAt=new Date().toISOString();
  persistContextPack({render:false,status:'工作指令已保存到本地工作包'});
}
function setContextPackMemoryMode(mode){
  contextPack.memoryMode=mode==='default'?'default':'project';
  contextPack.updatedAt=new Date().toISOString();
  persistContextPack({toast:contextPack.memoryMode==='project'?'已切换为项目内记忆边界':'已切换为默认会话记忆'});
}
function toggleContextPackCanvas(enabled){
  contextPack.includeCanvas=Boolean(enabled);
  contextPack.updatedAt=new Date().toISOString();
  persistContextPack({toast:contextPack.includeCanvas?'Canvas 草稿会随下一次提问提交':'已停止随提问提交 Canvas 草稿'});
}
function activeTraceId(){
  return currentTrace?.id || currentTrace?.trace_id || '';
}
function addSessionToContextPack(sessionId){
  if(!sessionId) return;
  contextPack.sessionIds=normalizeIdList([sessionId,...asList(contextPack.sessionIds)],8);
  contextPack.sessionId=contextPack.sessionIds[0]||sessionId;
}
function captureContextPack(){
  const ctx=chatContextSnapshot();
  if(ctx.agent?.id) contextPack.agentId=ctx.agent.id;
  if(ctx.dataset?.id) contextPack.datasetIds=normalizeIdList([...contextPack.datasetIds,ctx.dataset.id],6);
  const traceId=activeTraceId();
  if(traceId) contextPack.traceIds=normalizeIdList([traceId,...contextPack.traceIds],6);
  if(activeSessionId) addSessionToContextPack(activeSessionId);
  contextPack.toolMode=ctx.toolMode;
  contextPack.evidenceDepth=ctx.evidenceDepth;
  contextPack.updatedAt=new Date().toISOString();
  persistContextPack({toast:'已捕获当前工作上下文'});
}
function addDatasetToContextPack(datasetId,btn){
  if(!datasetId) return;
  setBusy(btn,true);
  contextPack.datasetIds=normalizeIdList([datasetId,...contextPack.datasetIds],6);
  contextPack.updatedAt=new Date().toISOString();
  persistContextPack({toast:'数据集已加入工作包'});
  setBusy(btn,false);
}
function addReportToContextPack(reportId,btn){
  if(!reportId) return;
  setBusy(btn,true);
  contextPack.reportIds=normalizeIdList([reportId,...contextPack.reportIds],4);
  contextPack.updatedAt=new Date().toISOString();
  persistContextPack({toast:'报告已加入工作包'});
  setBusy(btn,false);
}
function addKnowledgeToContextPack(knowledgeBaseId,btn){
  if(!knowledgeBaseId) return;
  setBusy(btn,true);
  contextPack.knowledgeBaseIds=normalizeIdList([knowledgeBaseId,...contextPack.knowledgeBaseIds],6);
  contextPack.updatedAt=new Date().toISOString();
  persistContextPack({toast:'知识库已加入工作包'});
  setBusy(btn,false);
}
function addContextAssetToPack(kind,id,btn){
  if(kind==='dataset') return addDatasetToContextPack(id,btn);
  if(kind==='knowledge') return addKnowledgeToContextPack(id,btn);
  if(kind==='report') return addReportToContextPack(id,btn);
}
function removeContextPackItem(kind,id){
  const removeId=list=>normalizeIdList(list.filter(x=>x!==id),12);
  if(kind==='agent') contextPack.agentId='';
  if(kind==='dataset') contextPack.datasetIds=removeId(contextPack.datasetIds);
  if(kind==='knowledge') contextPack.knowledgeBaseIds=removeId(contextPack.knowledgeBaseIds);
  if(kind==='report') contextPack.reportIds=removeId(contextPack.reportIds);
  if(kind==='trace') contextPack.traceIds=removeId(contextPack.traceIds);
  if(kind==='session'){
    contextPack.sessionIds=removeId(asList(contextPack.sessionIds));
    contextPack.sessionId=contextPack.sessionIds[0]||'';
  }
  contextPack.updatedAt=new Date().toISOString();
  persistContextPack({toast:'已从工作包移除'});
}
function openContextPackItem(kind,id){
  if(kind==='agent') return openAgentCommand(id);
  if(kind==='dataset') return openDatasetCommand(id);
  if(kind==='knowledge') return openKnowledgeCommand(id);
  if(kind==='report') return openReportCommand(id);
  if(kind==='trace'){ showPage('chat'); setTimeout(()=>openTrace(id),120); return; }
  if(kind==='session') return openSessionCommand(id);
}
function addTraceToContextPack(traceId,btn){
  if(!traceId) return;
  setBusy(btn,true);
  contextPack.traceIds=normalizeIdList([traceId,...contextPack.traceIds],6);
  if(activeSessionId) addSessionToContextPack(activeSessionId);
  contextPack.updatedAt=new Date().toISOString();
  persistContextPack({toast:'Trace 已加入工作包'});
  setBusy(btn,false);
}
function clearContextPack(){
  if(!contextPackHasContent()) return toast('工作包已为空');
  if(!window.confirm('清空本地工作包？')) return;
  contextPack=defaultContextPack();
  try{localStorage.removeItem(CONTEXT_PACK_STORAGE_KEY);}catch(e){}
  syncContextPackPanel();
  toast('工作包已清空');
}
function contextPackPrompt(){
  const p=normalizeContextPack(contextPack);
  const lines=['使用以下工作包上下文继续分析：'];
  lines.push(`记忆边界：${p.memoryMode==='project'?'只使用本工作包和当前会话上下文':'使用默认会话上下文，并参考工作包'}`);
  if(p.instructions.trim()) lines.push('', `工作指令：${p.instructions.trim()}`);
  if(p.agentId) lines.push(`Agent：${contextPackAgentName()||p.agentId}`);
  if(p.datasetIds.length) lines.push(`数据集：${p.datasetIds.map(datasetName).join('、')}`);
  if(p.knowledgeBaseIds.length) lines.push(`知识库：${p.knowledgeBaseIds.map(knowledgeBaseName).join('、')}`);
  if(p.reportIds.length) lines.push(`报告：${p.reportIds.map(id=>short(contextPackReportTitle(id),42)).join('、')}`);
  if(p.traceIds.length) lines.push(`Trace：${p.traceIds.join('、')}`);
  if(p.sessionIds.length) lines.push(`来源会话：${p.sessionIds.join('、')}`);
  if(p.includeCanvas&&chatCanvasValue().trim()) lines.push(`Canvas 草稿：${short(chatCanvasValue().trim().replace(/\s+/g,' '),520)}`);
  lines.push('', '请保持 RBAC、SQL Guard、Trace 和审计证据链，不要绕过权限或数据分级。', '本次问题：');
  return lines.join('\n');
}
function contextPackCanvasMarkdown(){
  const p=normalizeContextPack(contextPack);
  const lines=['# 工作包上下文','',`状态：${contextPackSummaryLabel()} (${contextPackSummaryDetail()})`,''];
  lines.push('## 记忆边界',`- ${p.memoryMode==='project'?'项目内：优先使用本工作包资产、指令和当前会话。':'默认：沿用当前会话上下文，并参考本工作包资产。'}`,'');
  if(p.instructions.trim()) lines.push('## 工作指令',p.instructions.trim(),'');
  if(p.agentId) lines.push('## Agent',`- ${contextPackAgentName()||p.agentId}`,'');
  if(p.datasetIds.length) lines.push('## 数据集',...p.datasetIds.map(id=>`- ${datasetName(id)} (${id})`),'');
  if(p.knowledgeBaseIds.length) lines.push('## 知识库',...p.knowledgeBaseIds.map(id=>`- ${knowledgeBaseName(id)} (${id})`),'');
  if(p.reportIds.length) lines.push('## 报告',...p.reportIds.map(id=>`- ${contextPackReportTitle(id)} (${id})`),'');
  if(p.traceIds.length) lines.push('## Trace',...p.traceIds.map(id=>`- ${id}`),'');
  if(p.sessionIds.length) lines.push('## 来源会话',...p.sessionIds.map(id=>`- ${id}`),'');
  if(p.includeCanvas&&chatCanvasValue().trim()) lines.push('## Canvas 草稿',chatCanvasValue().trim().slice(0,3000),'');
  lines.push('## 下一步','- 基于工作包继续提问或生成报告要点。','- 若涉及 SQL，先通过 SQL Guard 并在 Trace 中复核。');
  return lines.join('\n');
}
function contextPackPayload(){
  const p=normalizeContextPack(contextPack);
  const payload={
    instructions:p.instructions,
    agent_id:p.agentId||null,
    dataset_ids:p.datasetIds,
    knowledge_base_ids:p.knowledgeBaseIds,
    report_ids:p.reportIds,
    trace_ids:p.traceIds,
    session_id:p.sessionId||null,
    session_ids:p.sessionIds,
    tool_mode:p.toolMode,
    evidence_depth:p.evidenceDepth,
    memory_mode:p.memoryMode,
    include_canvas:p.includeCanvas
  };
  if(p.includeCanvas&&chatCanvasValue().trim()) payload.canvas_markdown=chatCanvasValue().trim().slice(0,6000);
  return payload;
}
function applyContextPackToChat(){
  const apply=()=>{
    const p=normalizeContextPack(contextPack);
    const agent=document.getElementById('chatAgent');
    if(p.agentId&&agent&&[...agent.options].some(o=>o.value===p.agentId)) agent.value=p.agentId;
    const dataset=document.getElementById('chatDataset');
    const firstDataset=p.datasetIds.find(id=>dataset&&[...dataset.options].some(o=>o.value===id));
    if(firstDataset) dataset.value=firstDataset;
    const depth=document.getElementById('traceDepth');
    if(depth) depth.value=p.evidenceDepth;
    setActiveToolMode(p.toolMode);
    const input=document.getElementById('chatInput');
    if(input){input.value=contextPackPrompt();input.focus();}
    syncChatContextBar();
    toast('工作包已应用到当前会话');
  };
  if(activePage!=='chat'||!document.getElementById('chatInput')){
    showPage('chat');
    setTimeout(apply,140);
    return;
  }
  apply();
}
function writeContextPackToCanvas(){
  const write=()=>setChatCanvasDraft(contextPackCanvasMarkdown(),'工作包已写入 Canvas');
  if(activePage!=='chat'||!document.getElementById('chatCanvasDraft')){
    showPage('chat');
    setTimeout(write,140);
    return;
  }
  write();
}
function chatPromptSeed(){
  const draft=(document.getElementById('chatInput')?.value||'').trim();
  const question=currentQuestionText();
  return draft || (question==='新对话'?'当前问题':question) || '当前问题';
}
function setActiveToolMode(mode){
  document.querySelectorAll('#toolMode button').forEach(b=>b.classList.toggle('active',b.dataset.mode===mode));
  syncChatContextBar();
}
function runChatQuickTool(kind){
  const ctx=chatContextSnapshot();
  const datasetId=ctx.dataset?.id || '';
  const datasetName=ctx.dataset?.name || '当前数据上下文';
  const prompt=chatPromptSeed();
  const relatedMetrics=ctx.dataset ? metricsForDataset(ctx.dataset) : metrics;
  const metric=relatedMetrics[0];
  if(kind==='metric'){
    setActiveToolMode('auto');
    setChatComposerDraft(`解释${metric?`指标“${metric.name||metric.code}”`:'当前核心指标'}的业务口径、计算公式、适用数据集、常见误读和可以继续追问的问题。`,'agent_router',datasetId);
    return;
  }
  if(kind==='chart'){
    setActiveToolMode('analysis');
    setChatComposerDraft(`基于${datasetName}生成适合回答“${prompt}”的图表方案，优先给出趋势、TopN 或分布，并说明图表口径和需要的 SQL Guard 约束。`,'agent_router',datasetId);
    return;
  }
  if(kind==='asset'){
    showPage('dataops');
    setTimeout(()=>{
      const btn=document.querySelector('#page-dataops .tabs button[data-tab="catalog"]');
      dataTab('catalog',btn);
      if(datasetId) setTimeout(()=>openDatasetDetail(datasetId,null),120);
    },100);
    return;
  }
  if(kind==='research'){
    setAnalysisDraft(`基于“${prompt}”继续做深度研究：明确分析目标、数据资产、关键指标、可验证假设、风险点和报告草稿结构。`,'agent_business_analysis');
    return;
  }
  if(kind==='codex'){
    setCodexDraft(`改造问数体验：${short(prompt,26)}`,`围绕智能问数会话“${prompt}”创建工程任务：检查前端交互、上下文绑定、Trace 证据、SQL Guard、RBAC、审计和移动端布局，提出并实现最小可验证改造。`);
  }
}
function composerCommandDefinitions(){
  return [
    {key:'metric',title:'解释指标',description:'生成指标口径、公式和可追问问题',hint:'/metric',run:()=>runChatQuickTool('metric')},
    {key:'chart',title:'生成图表方案',description:'切到分析模式并生成图表提问草稿',hint:'/chart',run:()=>runChatQuickTool('chart')},
    {key:'sql',title:'SQL 草稿到 Canvas',description:'把当前问题整理成可审计 SQL 草稿',hint:'/sql',run:()=>runChatCanvasAction('sql')},
    {key:'canvas',title:'分析大纲到 Canvas',description:'在 Canvas 创建当前问题的分析大纲',hint:'/canvas',run:()=>runChatCanvasAction('brief')},
    {key:'report',title:'报告要点到 Canvas',description:'生成报告要点草稿并保留本地版本',hint:'/report',run:()=>runChatCanvasAction('report')},
    {key:'context',title:'应用工作包',description:'把 Context Pack 资产、指令和记忆边界写入 composer',hint:'/context',run:()=>applyContextPackToChat()},
    {key:'capture',title:'捕获当前上下文',description:'把当前 Agent、数据集、Trace 和会话加入工作包',hint:'/capture',run:()=>captureContextPack()},
    {key:'research',title:'转深度研究',description:'把当前问题带到研究计划和报告工作流',hint:'/research',run:()=>runChatQuickTool('research')},
    {key:'codex',title:'创建 Codex 任务',description:'把当前问题转成工程改造任务草稿',hint:'/codex',run:()=>runChatQuickTool('codex')},
    {key:'asset',title:'打开数据资产',description:'跳到数据能力页查看字段、指标和画像',hint:'/asset',run:()=>runChatQuickTool('asset')}
  ];
}
function composerCommandQuery(){
  const value=document.getElementById('chatInput')?.value||'';
  if(!value.trim().startsWith('/')) return null;
  return value.trim().slice(1).toLowerCase();
}
function composerCommandMatches(item,q=''){
  return [item.key,item.title,item.description,item.hint].join(' ').toLowerCase().includes(q);
}
function currentComposerCommands(){
  const q=composerCommandQuery();
  if(q===null) return [];
  return composerCommandDefinitions().filter(item=>composerCommandMatches(item,q)).slice(0,8);
}
function hideComposerCommandMenu(){
  const menu=document.getElementById('composerCommandMenu');
  if(menu) menu.classList.add('hidden');
}
function renderComposerCommandMenu(){
  const menu=document.getElementById('composerCommandMenu');
  if(!menu) return;
  const q=composerCommandQuery();
  if(q===null){ hideComposerCommandMenu(); return; }
  const items=currentComposerCommands();
  composerCommandIndex=Math.min(composerCommandIndex,Math.max(items.length-1,0));
  menu.classList.remove('hidden');
  menu.innerHTML=`<div class="composer-command-head"><b>工具</b><span>输入 / 后选择动作</span></div>${items.length?items.map((item,i)=>`<button type="button" role="option" aria-selected="${i===composerCommandIndex}" class="composer-command-item ${i===composerCommandIndex?'active':''}" onmousedown="event.preventDefault()" onclick="runComposerCommand(${i})"><span>${esc(item.hint)}</span><div><b>${esc(item.title)}</b><p>${esc(item.description)}</p></div></button>`).join(''):emptyState('没有匹配工具','试试 /canvas、/sql、/context 或 /codex。')}`;
}
function updateComposerCommandActive(){
  document.querySelectorAll('#composerCommandMenu .composer-command-item').forEach((b,i)=>{
    b.classList.toggle('active',i===composerCommandIndex);
    b.setAttribute('aria-selected',String(i===composerCommandIndex));
  });
}
function runComposerCommand(index=composerCommandIndex){
  const items=currentComposerCommands();
  const item=items[index];
  if(!item) return;
  const input=document.getElementById('chatInput');
  if(input) input.value='';
  hideComposerCommandMenu();
  item.run();
  toast(`${item.title} 已执行`);
}
function handleComposerKey(e){
  const menu=document.getElementById('composerCommandMenu');
  const open=menu&&!menu.classList.contains('hidden');
  if(open&&e.key==='ArrowDown'){
    e.preventDefault();
    const items=currentComposerCommands();
    composerCommandIndex=Math.min(items.length-1,composerCommandIndex+1);
    updateComposerCommandActive();
    return;
  }
  if(open&&e.key==='ArrowUp'){
    e.preventDefault();
    composerCommandIndex=Math.max(0,composerCommandIndex-1);
    updateComposerCommandActive();
    return;
  }
  if(open&&e.key==='Escape'){
    e.preventDefault();
    hideComposerCommandMenu();
    return;
  }
  if(open&&e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    runComposerCommand();
    return;
  }
  if(e.key==='Enter'&&!e.shiftKey){
    e.preventDefault();
    sendChat();
  }
}
function renderChatCanvas(){
  return `<section class="chat-canvas-card" aria-label="工作 Canvas">
    <div class="pane-title canvas-title"><span>Canvas</span><div><h2>工作 Canvas</h2><p>把当前会话整理成可编辑 brief、SQL 草稿或报告大纲。</p></div></div>
    <textarea id="chatCanvasDraft" rows="9" placeholder="生成分析大纲、SQL 草稿或报告要点后，可在这里继续编辑。" oninput="chatCanvasDraft=this.value;syncCanvasSelectionState()" onselect="syncCanvasSelectionState()" onkeyup="syncCanvasSelectionState()" onclick="syncCanvasSelectionState()" onblur="recordChatCanvasVersion('手动编辑')">${esc(chatCanvasDraft)}</textarea>
    <div class="canvas-select-tools" aria-label="Canvas 选区工具">
      <span id="canvasSelectionState">选择文本后可定向编辑</span>
      <div class="canvas-format-tools" aria-label="Markdown 格式">
        <button class="report-action" title="加粗" aria-label="加粗选区" onclick="formatChatCanvasSelection('bold')"><b>B</b></button>
        <button class="report-action" title="斜体" aria-label="斜体选区" onclick="formatChatCanvasSelection('italic')"><i>I</i></button>
        <button class="report-action" title="二级标题" aria-label="设置为二级标题" onclick="formatChatCanvasSelection('heading')">H2</button>
        <button class="report-action" title="项目列表" aria-label="设置为项目列表" onclick="formatChatCanvasSelection('bullet')">•</button>
        <button class="report-action" title="编号列表" aria-label="设置为编号列表" onclick="formatChatCanvasSelection('numbered')">1.</button>
      </div>
      <button class="report-action" onclick="runChatCanvasEdit('polish')">润色选区</button>
      <button class="report-action" onclick="runChatCanvasEdit('evidence')">补证据</button>
      <button class="report-action" onclick="runChatCanvasEdit('shorten')">压缩</button>
      <button class="report-action" onclick="runChatCanvasEdit('expand')">展开</button>
      <button class="report-action ghost-tool" onclick="runChatCanvasEdit('ask')">带选区提问</button>
    </div>
    <div class="canvas-actions">
      <button class="report-action" onclick="runChatCanvasAction('brief')">分析大纲</button>
      <button class="report-action" onclick="runChatCanvasAction('sql')">SQL 草稿</button>
      <button class="report-action" onclick="runChatCanvasAction('report')">报告要点</button>
      <button class="report-action" onclick="runChatCanvasAction('trace')">附加 Trace</button>
      <button class="report-action" onclick="saveChatCanvasAsReport(this)">保存报告</button>
      <button class="report-action" onclick="downloadChatCanvasMarkdown(this)">下载 Markdown</button>
      <button class="report-action ghost-tool" onclick="copyChatCanvas(this)">复制</button>
    </div>
    <div id="chatCanvasVersionBar">${renderChatCanvasVersionBar()}</div>
    <div id="chatCanvasDiffPanel">${chatCanvasDiffVisible?renderChatCanvasDiffPanel():''}</div>
    <small id="chatCanvasStatus" class="canvas-status">本地草稿，不会绕过报告复核或审计流程。</small>
  </section>`;
}
function chatCanvasValue(){
  const el=document.getElementById('chatCanvasDraft');
  return el?el.value:chatCanvasDraft;
}
function setChatCanvasDraft(text,status='Canvas 已更新',opts={}){
  chatCanvasDraft=text;
  chatCanvasLastSelection={start:0,end:0,text:''};
  const el=document.getElementById('chatCanvasDraft');
  if(el) el.value=text;
  const statusBox=document.getElementById('chatCanvasStatus');
  if(statusBox) statusBox.innerText=status;
  if(opts.record!==false) recordChatCanvasVersion(opts.reason||status);
  else syncChatCanvasVersionBar();
  syncCanvasSelectionState();
}
function chatCanvasSelection(){
  const el=document.getElementById('chatCanvasDraft');
  const text=chatCanvasValue();
  if(!el) return {start:0,end:0,text:'',full:text};
  const start=el.selectionStart||0;
  const end=el.selectionEnd||0;
  if(start!==end){
    chatCanvasLastSelection={start,end,text:text.slice(start,end)};
    return {start,end,text:text.slice(start,end),full:text};
  }
  if(chatCanvasLastSelection.text&&text.slice(chatCanvasLastSelection.start,chatCanvasLastSelection.end)===chatCanvasLastSelection.text){
    return {start:chatCanvasLastSelection.start,end:chatCanvasLastSelection.end,text:chatCanvasLastSelection.text,full:text};
  }
  return {start,end,text:text.slice(start,end),full:text};
}
function syncCanvasSelectionState(){
  const state=document.getElementById('canvasSelectionState');
  if(!state) return;
  const selected=chatCanvasSelection().text.trim();
  state.innerText=selected?`已选择 ${selected.length} 字，可定向编辑`:'选择文本后可定向编辑';
}
function recordChatCanvasVersion(reason='版本记录'){
  const text=chatCanvasValue();
  if(!text.trim()){ syncChatCanvasVersionBar(); return; }
  const current=chatCanvasVersions[chatCanvasVersionIndex];
  if(current&&current.text===text){ syncChatCanvasVersionBar(); return; }
  chatCanvasDiffVisible=false;
  if(chatCanvasVersionIndex<chatCanvasVersions.length-1) chatCanvasVersions=chatCanvasVersions.slice(0,chatCanvasVersionIndex+1);
  chatCanvasVersions.push({text,reason,at:new Date().toISOString()});
  if(chatCanvasVersions.length>12) chatCanvasVersions=chatCanvasVersions.slice(-12);
  chatCanvasVersionIndex=chatCanvasVersions.length-1;
  syncChatCanvasVersionBar();
}
function renderChatCanvasVersionBar(){
  const total=chatCanvasVersions.length;
  const current=total?chatCanvasVersionIndex+1:0;
  const item=total?chatCanvasVersions[chatCanvasVersionIndex]:null;
  const canDiff=total>1&&chatCanvasVersionIndex>0;
  return `<div class="canvas-version-bar">
    <span>${total?`版本 ${current}/${total} · ${esc(item.reason||'更新')} · ${esc(timeText(item.at))}`:'暂无版本记录'}</span>
    <div>
      <button class="report-action" onclick="recordChatCanvasVersion('手动记录')" ${chatCanvasValue().trim()?'':'disabled'}>记录</button>
      <button class="report-action" onclick="restoreChatCanvasVersion(-1)" ${current>1?'':'disabled'}>上一版</button>
      <button class="report-action" onclick="restoreChatCanvasVersion(1)" ${current<total?'':'disabled'}>下一版</button>
      <button class="report-action ghost-tool" onclick="toggleChatCanvasDiff()" ${canDiff?'':'disabled'}>${chatCanvasDiffVisible?'隐藏变化':'变化'}</button>
    </div>
  </div>`;
}
function syncChatCanvasVersionBar(){
  const bar=document.getElementById('chatCanvasVersionBar');
  if(bar) bar.innerHTML=renderChatCanvasVersionBar();
  const diff=document.getElementById('chatCanvasDiffPanel');
  if(diff) diff.innerHTML=chatCanvasDiffVisible?renderChatCanvasDiffPanel():'';
}
function restoreChatCanvasVersion(delta){
  const next=chatCanvasVersionIndex+delta;
  if(next<0||next>=chatCanvasVersions.length) return;
  chatCanvasVersionIndex=next;
  chatCanvasDiffVisible=false;
  setChatCanvasDraft(chatCanvasVersions[next].text,`已恢复到版本 ${next+1}`,{record:false});
}
function toggleChatCanvasDiff(){
  if(chatCanvasVersions.length<2||chatCanvasVersionIndex<1) return;
  chatCanvasDiffVisible=!chatCanvasDiffVisible;
  syncChatCanvasVersionBar();
}
function canvasLineDiff(before='',after=''){
  const a=String(before||'').split('\n');
  const b=String(after||'').split('\n');
  const dp=Array.from({length:a.length+1},()=>Array(b.length+1).fill(0));
  for(let i=a.length-1;i>=0;i--){
    for(let j=b.length-1;j>=0;j--){
      dp[i][j]=a[i]===b[j]?dp[i+1][j+1]+1:Math.max(dp[i+1][j],dp[i][j+1]);
    }
  }
  const rows=[];
  let i=0,j=0;
  while(i<a.length&&j<b.length){
    if(a[i]===b[j]){ rows.push({type:'same',text:a[i]}); i++; j++; }
    else if(dp[i+1][j]>=dp[i][j+1]){ rows.push({type:'del',text:a[i++]}); }
    else{ rows.push({type:'add',text:b[j++]}); }
  }
  while(i<a.length) rows.push({type:'del',text:a[i++]});
  while(j<b.length) rows.push({type:'add',text:b[j++]});
  return rows;
}
function renderChatCanvasDiffPanel(){
  const current=chatCanvasVersions[chatCanvasVersionIndex];
  const previous=chatCanvasVersions[chatCanvasVersionIndex-1];
  if(!current||!previous) return '';
  const rows=canvasLineDiff(previous.text,current.text).filter(row=>row.type!=='same'||row.text.trim()).slice(0,120);
  const changed=rows.filter(row=>row.type!=='same').length;
  return `<div class="canvas-diff-panel" aria-live="polite">
    <div class="canvas-diff-head"><b>版本变化</b><span>对比 ${chatCanvasVersionIndex} → ${chatCanvasVersionIndex+1} · ${changed} 处变化</span></div>
    <div class="canvas-diff-list">${rows.length?rows.map(row=>`<div class="canvas-diff-line ${row.type}"><span>${row.type==='add'?'+':row.type==='del'?'-':' '}</span><code>${esc(row.text||' ')}</code></div>`).join(''):emptyState('没有可显示变化','当前版本和上一版内容一致。')}</div>
  </div>`;
}
function canvasSelectionTarget(){
  const selection=chatCanvasSelection();
  const selected=selection.text.trim();
  return {
    range:selection,
    text:selected||selection.full.trim(),
    hasSelection:Boolean(selected)
  };
}
function replaceChatCanvasRange(start,end,nextText,status,selectionStart=0,selectionEnd=nextText.length){
  const full=chatCanvasValue();
  const updated=full.slice(0,start)+nextText+full.slice(end);
  setChatCanvasDraft(updated,status,{reason:status});
  requestAnimationFrame(()=>{
    const el=document.getElementById('chatCanvasDraft');
    if(!el) return;
    const from=start+selectionStart;
    const to=start+selectionEnd;
    el.focus();
    el.setSelectionRange(from,to);
    syncCanvasSelectionState();
  });
}
function markdownLineFormat(text,kind){
  let number=1;
  return String(text||'').split('\n').map(line=>{
    if(!line.trim()) return line;
    const clean=line.replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+\.\s+)/,'').trimStart();
    if(kind==='heading') return `## ${clean}`;
    if(kind==='numbered') return `${number++}. ${clean}`;
    return `- ${clean}`;
  }).join('\n');
}
function formatChatCanvasSelection(kind){
  const el=document.getElementById('chatCanvasDraft');
  if(!el) return toast('Canvas 未打开');
  const full=chatCanvasValue();
  const start=el.selectionStart||0;
  const end=el.selectionEnd||0;
  const selected=full.slice(start,end);
  const inline={
    bold:{open:'**',close:'**',placeholder:'重点',status:'Canvas 已加粗'},
    italic:{open:'*',close:'*',placeholder:'强调',status:'Canvas 已设为斜体'}
  };
  if(inline[kind]){
    const spec=inline[kind];
    const body=selected||spec.placeholder;
    const next=`${spec.open}${body}${spec.close}`;
    replaceChatCanvasRange(start,end,next,spec.status,spec.open.length,spec.open.length+body.length);
    return;
  }
  if(kind==='heading'||kind==='bullet'||kind==='numbered'){
    const placeholders={heading:'小节标题',bullet:'列表项',numbered:'列表项'};
    const statuses={heading:'Canvas 已设为标题',bullet:'Canvas 已设为项目列表',numbered:'Canvas 已设为编号列表'};
    const body=selected||placeholders[kind]||'列表项';
    const next=markdownLineFormat(body,kind);
    replaceChatCanvasRange(start,end,next,statuses[kind]||'Canvas 已格式化',0,next.length);
  }
}
function polishedCanvasText(text){
  const lines=String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
  if(!lines.length) return '';
  return lines.map(line=>{
    if(/^#{1,6}\s/.test(line)||/^[-*]\s/.test(line)||/^\d+\.\s/.test(line)) return line;
    if(line.length>46) return line;
    return `- ${line}`;
  }).join('\n');
}
function evidenceCanvasText(text){
  const traceId=activeTraceId();
  const ctx=chatCanvasContext();
  return [text.trim(),'','证据补充：',`- Trace：${traceId||ctx.traceId||'待生成 Trace'}`,`- 数据集：${ctx.datasetName}`,`- 权限：发送或执行前继续通过 RBAC、masking 和 SQL Guard 复核`,`- 审计：保存报告或创建任务后保留来源会话与证据链`].join('\n');
}
function shortenCanvasText(text){
  const lines=String(text||'').split(/\n+/).map(x=>x.trim()).filter(Boolean).slice(0,6);
  return ['摘要：',...lines.map(line=>`- ${short(line.replace(/^[-*]\s*/,''),88)}`)].join('\n');
}
function expandCanvasText(text){
  const ctx=chatCanvasContext();
  return [text.trim(),'','展开方向：',`- 业务问题：${ctx.question}`,'- 口径：补充指标定义、时间范围和过滤条件。','- 证据：附上 SQL、Trace、权限检查和行数。','- 风险：标记数据分级、脱敏、样本量和异常值。','- 下一步：转深度研究、保存报告或创建 Codex 工程任务。'].join('\n');
}
function replaceChatCanvasTarget(nextText,status){
  const target=canvasSelectionTarget();
  if(!target.text) return toast('Canvas 为空');
  const full=chatCanvasValue();
  let start=0, end=full.length;
  if(target.hasSelection){ start=target.range.start; end=target.range.end; }
  replaceChatCanvasRange(start,end,nextText,status,0,nextText.length);
}
function runChatCanvasEdit(kind){
  const target=canvasSelectionTarget();
  if(!target.text) return toast('Canvas 为空');
  if(kind==='ask'){
    const prompt=`基于 Canvas ${target.hasSelection?'选区':'全文'}继续追问：\n${target.text}\n\n请补充口径、证据、风险和下一步动作。`;
    setChatComposerDraft(prompt,document.getElementById('chatAgent')?.value||'agent_router',document.getElementById('chatDataset')?.value||'');
    return;
  }
  const transforms={
    polish:[polishedCanvasText,'Canvas 选区已润色'],
    evidence:[evidenceCanvasText,'Canvas 已补充证据'],
    shorten:[shortenCanvasText,'Canvas 选区已压缩'],
    expand:[expandCanvasText,'Canvas 选区已展开']
  };
  const [fn,status]=transforms[kind]||transforms.polish;
  replaceChatCanvasTarget(fn(target.text),status);
}
function chatCanvasContext(){
  const ctx=chatContextSnapshot();
  const datasetId=ctx.dataset?.id || defaultQueryDataset();
  const dataset=ctx.dataset || datasets.find(d=>d.id===datasetId) || null;
  const metricList=(dataset?metricsForDataset(dataset):metrics).slice(0,4).map(m=>m.name||m.code).filter(Boolean);
  return {
    ctx,
    datasetId,
    datasetName:dataset?.name || '自动选择',
    datasetTable:dataset?.physical_table || datasetId || 'sales_orders',
    metrics:metricList.length?metricList:['收入','订单数','客单价'],
    question:chatPromptSeed(),
    traceId:currentTrace?.id || currentTrace?.trace_id || ''
  };
}
function chatCanvasTemplate(kind){
  const c=chatCanvasContext();
  if(kind==='sql'){
    return [`# SQL 草稿：${c.question}`,'',`数据集：${c.datasetName} (${c.datasetTable})`,'', '```sql', sampleSqlForDataset(c.datasetId), '```', '', '- 只允许只读查询', '- 执行前必须通过 SQL Guard', '- 结果需要回到 Trace 复核权限、SQL 和行数'].join('\n');
  }
  if(kind==='report'){
    return [`# 报告要点：${c.question}`,'',`## 上下文`, `- Agent：${c.ctx.agent?.name||'自动路由'}`, `- 数据集：${c.datasetName}`, `- 关键指标：${c.metrics.join('、')}`, `- 证据：${c.traceId||'待生成 Trace'}`, '', '## 初步结论', '- 待基于问数回答和 Trace 补充。', '', '## 需要复核', '- SQL 口径是否匹配业务定义', '- 数据分级、masking 和 RBAC 是否满足要求', '- 是否需要转深度研究或创建 Codex 任务'].join('\n');
  }
  if(kind==='trace'){
    const existing=chatCanvasValue().trim();
    const traceText=currentTrace?[``, `## Trace 证据`, `- Trace：${currentTrace.id||currentTrace.trace_id||'-'}`, `- Agent：${currentTrace.agent_id||'-'}`, `- 状态：${displayValue(currentTrace.status||'-')}`, `- 输入：${currentTrace.input||'-'}`].join('\n'):['', '## Trace 证据', '- 当前还没有可附加的 Trace；发送问题后再附加。'].join('\n');
    return existing ? `${existing}\n${traceText}` : traceText.trim();
  }
  return [`# 分析大纲：${c.question}`,'',`## 项目上下文`, `- Agent：${c.ctx.agent?.name||'自动路由'}`, `- 数据集：${c.datasetName}`, `- 工具模式：${displayValue(c.ctx.toolMode)}`, `- 证据深度：${c.ctx.evidenceDepth==='full'?'完整证据':'标准 Trace'}`, '', '## 要回答的问题', `- ${c.question}`, '', '## 关键指标', ...c.metrics.map(m=>`- ${m}`), '', '## 执行计划', '- 明确业务口径和时间范围', '- 用只读 SQL 或数据画像验证', '- 将结论、SQL、权限和步骤写入 Trace', '- 输出后续追问、深度研究或 Codex 工程任务'].join('\n');
}
function runChatCanvasAction(kind){
  const labels={brief:'分析大纲',sql:'SQL 草稿',report:'报告要点',trace:'Trace'};
  setChatCanvasDraft(chatCanvasTemplate(kind),`${labels[kind]||'Canvas'} 已生成`);
}
async function saveChatCanvasAsReport(btn){
  const content=chatCanvasValue().trim();
  if(!content) return toast('Canvas 为空');
  setBusy(btn,true);
  try{
    const report=await api('/api/reports',{method:'POST',body:JSON.stringify({
      title:short(`Canvas 报告：${chatCanvasContext().question}`,120),
      report_type:'chat_canvas',
      agent_id:document.getElementById('chatAgent')?.value||null,
      content_markdown:content,
      evidence:[{type:'chat_canvas',title:chatCanvasContext().question,summary:short(content,240),trace_id:chatCanvasContext().traceId,session_id:activeSessionId||''}]
    })});
    toast('Canvas 已保存为报告草稿');
    showPage('reports');
    setTimeout(()=>openReportDetail(report.id,null),160);
  }catch(e){
    toast('保存 Canvas 失败：'+e.message);
  }finally{
    setBusy(btn,false);
  }
}
function copyChatCanvas(btn){
  const text=chatCanvasValue().trim();
  if(!text) return toast('Canvas 为空');
  return copyAnswerText(text,btn);
}
function safeDownloadStem(text,fallback='chat-canvas'){
  const stem=String(text||'').trim().replace(/[\\/:*?"<>|\s]+/g,'-').replace(/^-+|-+$/g,'').slice(0,56);
  return stem || fallback;
}
function downloadChatCanvasMarkdown(btn){
  const text=chatCanvasValue().trim();
  if(!text) return toast('Canvas 为空');
  setBusy(btn,true);
  try{
    const date=new Date().toISOString().slice(0,10);
    const filename=`${safeDownloadStem(chatCanvasContext().question)}-${date}.md`;
    const blob=new Blob([text+'\n'],{type:'text/markdown;charset=utf-8'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');
    link.href=url;
    link.download=filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),0);
    const status=document.getElementById('chatCanvasStatus');
    if(status) status.innerText=`已下载 ${filename}`;
    toast('Canvas 已下载为 Markdown');
  }catch(e){
    toast('下载失败：'+e.message);
  }finally{
    setBusy(btn,false);
  }
}
function selectedChatContext(){
  const base={
    dataset_id:document.getElementById('chatDataset')?.value||null,
    tool_mode:document.querySelector('#toolMode button.active')?.dataset.mode||'auto',
    evidence_depth:document.getElementById('traceDepth')?.value||'standard'
  };
  if(contextPackHasContent()) base.context_pack=contextPackPayload();
  return base;
}
function sessionFilterQuery(){
  return compactText(chatSessionFilter.q).toLowerCase();
}
function sessionStatusMatches(s,status=chatSessionFilter.status||'active'){
  const pack=normalizeContextPack(contextPack);
  return status==='all'
    || (status==='project' ? pack.sessionIds.includes(s.id) : (s.status||'active')===status);
}
function searchValueText(value,depth=0){
  if(value===null||value===undefined||depth>3) return '';
  if(['string','number','boolean'].includes(typeof value)) return String(value);
  if(Array.isArray(value)) return value.slice(0,20).map(v=>searchValueText(v,depth+1)).filter(Boolean).join(' ');
  if(typeof value==='object'){
    return Object.entries(value).slice(0,24).map(([k,v])=>{
      const text=searchValueText(v,depth+1);
      return text?`${k}: ${text}`:'';
    }).filter(Boolean).join(' ');
  }
  return '';
}
function messageSearchText(message={}){
  const raw=String(message.content||'');
  if(!raw) return '';
  try{
    const parsed=JSON.parse(raw);
    if(parsed&&typeof parsed==='object'){
      return compactText([
        parsed.answer,
        parsed.report_markdown,
        searchValueText(parsed.sql),
        searchValueText(parsed.tables),
        searchValueText(parsed.charts),
        searchValueText(parsed.evidence),
        searchValueText(parsed.warnings),
        searchValueText(parsed.next_actions),
        parsed.summary,
        ...(Array.isArray(parsed.follow_up_questions)?parsed.follow_up_questions:[])
      ].filter(Boolean).join(' '));
    }
  }catch(e){}
  return compactText(raw);
}
function buildSessionSearchIndex(session={}){
  const turns=asList(session.messages).map(m=>{
    const role=m.role==='user'?'用户':(m.role==='assistant'?'助手':displayValue(m.role||'消息'));
    const text=messageSearchText(m);
    return text?`${role}：${text}`:'';
  }).filter(Boolean);
  const raw=turns.join(' · ');
  return {status:'loaded', raw, text:raw.toLowerCase(), loadedAt:Date.now()};
}
function ensureSessionSearchIndex(q,sessions=[]){
  if(!q||q.length<2) return;
  sessions.slice(0,80).forEach(s=>{
    if(!s?.id || sessionSearchCache[s.id]) return;
    sessionSearchCache[s.id]={status:'pending', raw:'', text:''};
    api('/api/sessions/'+encodeURIComponent(s.id)).then(session=>{
      sessionSearchCache[s.id]=buildSessionSearchIndex(session);
    }).catch(e=>{
      sessionSearchCache[s.id]={status:'error', raw:'', text:'', error:e.message};
    }).finally(()=>{
      if(sessionFilterQuery()===q) renderSessionList();
    });
  });
}
function sessionSearchHaystack(s){
  const cached=sessionSearchCache[s.id];
  return [s.title,s.id,s.agent_id,s.status,cached?.text].filter(Boolean).join(' ').toLowerCase();
}
function searchSnippet(text,q,limit=92){
  const clean=compactText(text);
  const needle=String(q||'').trim().toLowerCase();
  if(!clean||!needle) return '';
  const idx=clean.toLowerCase().indexOf(needle);
  if(idx<0) return '';
  const start=Math.max(0,idx-28);
  const end=Math.min(clean.length,idx+needle.length+limit-28);
  return `${start>0?'…':''}${clean.slice(start,end)}${end<clean.length?'…':''}`;
}
function highlightSnippet(text,q){
  const needle=String(q||'').trim();
  const lower=String(text||'').toLowerCase();
  const idx=needle?lower.indexOf(needle.toLowerCase()):-1;
  if(idx<0) return esc(text);
  return `${esc(text.slice(0,idx))}<mark>${esc(text.slice(idx,idx+needle.length))}</mark>${esc(text.slice(idx+needle.length))}`;
}
function sessionSearchSnippet(s,q){
  return searchSnippet(sessionSearchCache[s.id]?.raw||'',q);
}
function sessionSearchMeta(q,statusSessions=[]){
  if(!q) return '';
  if(q.length<2) return `<div class="session-search-meta">继续输入以搜索历史消息内容。</div>`;
  const target=statusSessions.slice(0,80);
  const loaded=target.filter(s=>sessionSearchCache[s.id]?.status==='loaded').length;
  const pending=target.filter(s=>sessionSearchCache[s.id]?.status==='pending').length;
  return `<div class="session-search-meta">${pending?inlineLoading('正在搜索历史消息'):''}<span>${loaded}/${target.length} 个会话内容已索引</span></div>`;
}
function setSessionFilter(status,btn){
  chatSessionFilter.status=status;
  document.querySelectorAll('.session-filter button').forEach(b=>b.classList.toggle('active',b===btn||b.dataset.status===status));
  renderSessionList();
}
function sessionMatches(s){
  const status=chatSessionFilter.status||'active';
  const q=sessionFilterQuery();
  return sessionStatusMatches(s,status) && (!q || sessionSearchHaystack(s).includes(q));
}
function sessionCard(s){
  const archived=(s.status||'active')==='archived';
  const linked=normalizeContextPack(contextPack).sessionIds.includes(s.id);
  const q=sessionFilterQuery();
  const snippet=sessionSearchSnippet(s,q);
  return `<article class="session-item ${s.id===activeSessionId?'active':''} ${archived?'archived':''} ${linked?'linked':''} ${snippet?'search-hit':''}">
    <button class="session-open" onclick="loadChatSession('${jsArg(s.id)}')"><b>${esc(sessionTitle(s))}</b><span>${esc(timeText(s.updated_at))} · ${esc(s.agent_id||'auto')}${linked?' · 工作包':''}</span></button>
    ${snippet?`<p class="session-snippet">命中：${highlightSnippet(snippet,q)}</p>`:''}
    <div class="session-actions">
      <button title="重命名会话" onclick="renameChatSession('${jsArg(s.id)}',this)">改名</button>
      <button title="${linked?'已加入工作包':'加入当前工作包'}" onclick="bindSessionToContextPack('${jsArg(s.id)}',this)" ${linked?'disabled':''}>${linked?'已加入':'加入'}</button>
      <button title="${archived?'恢复会话':'归档会话'}" onclick="toggleChatSessionArchive('${jsArg(s.id)}',${archived},this)">${archived?'恢复':'归档'}</button>
    </div>
  </article>`;
}
function renderSessionList(){
  const box=document.getElementById('chatSessionList');
  if(!box) return;
  const q=sessionFilterQuery();
  const status=chatSessionFilter.status||'active';
  const statusSessions=chatSessions.filter(s=>sessionStatusMatches(s,status));
  ensureSessionSearchIndex(q,statusSessions);
  const filtered=chatSessions.filter(sessionMatches);
  const empty=chatSessionFilter.status==='project'
    ? emptyState('暂无项目会话','在任一会话卡片点击“加入”，或加载含来源会话的工作包预设。')
    : emptyState('暂无匹配会话','调整搜索或切换活跃/归档状态。');
  box.innerHTML=`${sessionSearchMeta(q,statusSessions)}${filtered.length?filtered.slice(0,40).map(sessionCard).join(''):empty}`;
}
async function refreshChatSessions(){
  chatSessions=await api('/api/sessions').catch(()=>[]);
  renderSessionList();
}
async function refreshCommandAssets(){
  const [sessions,reports,knowledgeBases]=await Promise.all([
    api('/api/sessions').catch(()=>chatSessions),
    api('/api/reports').catch(()=>reportsCache),
    api('/api/knowledge-bases').catch(()=>knowledgeBasesCache)
  ]);
  chatSessions=sessions||[];
  reportsCache=reports||[];
  knowledgeBasesCache=knowledgeBases||[];
  commandAssetsLoaded=true;
}
async function updateChatSession(id,payload,btn){
  setBusy(btn,true);
  try{
    const updated=await api('/api/sessions/'+id,{method:'PATCH',body:JSON.stringify(payload)});
    chatSessions=chatSessions.map(s=>s.id===id?updated:s);
    if(updated.id===activeSessionId){
      const title=document.getElementById('chatSessionTitle');
      if(title) title.innerText=updated.title||updated.id;
    }
    renderSessionList();
    return updated;
  }finally{
    setBusy(btn,false);
  }
}
async function renameChatSession(id,btn){
  const current=chatSessions.find(s=>s.id===id);
  const title=window.prompt('重命名会话', current?.title||'');
  if(title===null) return;
  const next=title.trim();
  if(!next) return toast('会话标题不能为空');
  try{
    await updateChatSession(id,{title:next},btn);
    toast('会话已重命名');
  }catch(e){
    toast('重命名失败：'+e.message);
  }
}
async function toggleChatSessionArchive(id,isArchived,btn){
  try{
    await updateChatSession(id,{status:isArchived?'active':'archived'},btn);
    if(id===activeSessionId && !isArchived) startNewChat();
    toast(isArchived?'会话已恢复':'会话已归档');
  }catch(e){
    toast('会话状态更新失败：'+e.message);
  }
}
function bindSessionToContextPack(id,btn){
  if(!id) return;
  setBusy(btn,true);
  try{
    addSessionToContextPack(id);
    contextPack.updatedAt=new Date().toISOString();
    persistContextPack({toast:'会话已加入当前工作包'});
  }finally{
    setBusy(btn,false);
  }
}
function startNewChat(){
  activeSessionId='';
  activeChatMessages=[];
  currentTrace=null;
  chatCanvasDraft='';
  chatCanvasVersions=[];
  chatCanvasVersionIndex=-1;
  const title=document.getElementById('chatSessionTitle'); if(title) title.innerText='新对话';
  const box=document.getElementById('chatMessages'); if(box) box.innerHTML=chatEmptyState();
  const trace=document.getElementById('traceBox'); if(trace) trace.innerHTML=emptyState('暂无 Trace','发送问题后会显示执行状态、SQL、工具调用与步骤输出。');
  setChatCanvasDraft('','Canvas 已清空',{record:false});
  syncChatBriefControls();
  renderSessionList();
  requestAnimationFrame(()=>document.getElementById('chatInput')?.focus());
}
function detachChatSessionForAgent(){
  if(activeSessionId) startNewChat();
}
async function loadChatSession(id){
  const box=document.getElementById('chatMessages');
  if(box) box.innerHTML=inlineLoading('正在加载会话');
  try{
    const session=await api('/api/sessions/'+id);
    sessionSearchCache[session.id]=buildSessionSearchIndex(session);
    activeSessionId=session.id;
    const title=document.getElementById('chatSessionTitle'); if(title) title.innerText=session.title||session.id;
    const agentSelect=document.getElementById('chatAgent'); if(agentSelect&&session.agent_id) agentSelect.value=session.agent_id;
    syncChatContextBar();
    const messages=session.messages||[];
    activeChatMessages=messages;
    if(box) box.innerHTML=messages.length?messages.map((m,i)=>chatMessageHtml(m,session.id,messages,i)).join(''):chatEmptyState();
    syncChatBriefControls();
    const traceId=latestTraceId(messages);
    const trace=document.getElementById('traceBox');
    if(traceId){
      if(trace) trace.innerHTML=inlineLoading('正在恢复历史 Trace');
      await openTrace(traceId);
    }else{
      currentTrace=null;
      if(trace) trace.innerHTML=emptyState('暂无可恢复 Trace','历史会话未包含 Trace ID；发送新问题后会刷新本轮证据。');
    }
    await refreshChatSessions();
    box?.scrollTo({top:box.scrollHeight});
  }catch(e){
    activeChatMessages=[];
    syncChatBriefControls();
    if(box) box.innerHTML=stateBanner('error','会话加载失败',e.message);
  }
}
function askPreset(q){const input=document.getElementById('chatInput'); if(input) input.value=q;sendChat()}
function currentQuestionText(){
  return currentTrace?.input || document.getElementById('chatSessionTitle')?.innerText || '当前问题';
}
async function sendFeedback(rating, traceId='', sessionId='', messageId='', btn){
  const bar=btn?.closest('.feedback-bar');
  const status=bar?.querySelector('.feedback-status');
  setBusy(btn,true);
  try{
    await api('/api/chat/feedback',{method:'POST',body:JSON.stringify({session_id:sessionId||null,message_id:messageId||null,trace_id:traceId||null,rating,feedback_type:'answer_quality',comment:''})});
    bar?.querySelectorAll('button').forEach(b=>b.classList.toggle('selected',b===btn));
    if(status) status.innerText='已记录';
    toast('反馈已记录');
  }catch(e){
    if(status) status.innerText='提交失败';
    toast('反馈失败：'+e.message);
  }finally{
    setBusy(btn,false);
  }
}
function handleNextAction(label){
  const text=String(label||'');
  const q=currentQuestionText();
  if(text.includes('明细')){
    showPage('dataops');
    setTimeout(()=>dataTab('query',document.querySelector('#page-dataops .tabs button[data-tab="query"]')),80);
    return;
  }
  if(text.includes('深度')||text.includes('分析')){
    showPage('analysis');
    setTimeout(()=>{const el=document.getElementById('analysisQuestion'); if(el) el.value=`基于“${q}”继续做深度分析，并给出经营建议。`;},80);
    return;
  }
  if(text.includes('面板')){
    showPage('panels');
    return;
  }
  if(text.toLowerCase().includes('codex')||text.includes('改造')||text.includes('开发')){
    showPage('codex');
    setTimeout(()=>{
      const title=document.getElementById('codexTitle'), prompt=document.getElementById('codexPrompt');
      if(title) title.value='基于问数结果创建工程改造任务';
      if(prompt) prompt.value=`围绕“${q}”对应的数据分析结果，设计并实现前端或数据面板改造；保持 RBAC、SQL Guard、Trace、审计和审批流不退化，并运行 python3 scripts/static_check.py。`;
    },100);
    return;
  }
  askGlobalQuery(text);
}
function dashboardPromptExamples(){
  return ['本月收入最高的渠道有哪些？','分析本月收入变化的主要原因','给我生成一个经营总览面板','创建一个前端面板优化 Codex 任务'];
}
function dashboardPromptButton(q){
  return `<button class="prompt-pill" onclick="document.getElementById('dashboardPrompt').value='${jsArg(q)}'">${esc(q)}</button>`;
}
function launchDashboardIntent(){
  const prompt=(document.getElementById('dashboardPrompt')?.value||'').trim();
  const target=document.getElementById('dashboardTarget')?.value||'chat';
  if(!prompt) return toast('请输入任务');
  if(target==='chat'){
    showPage('chat');
    setTimeout(()=>askPreset(prompt),80);
    return;
  }
  if(target==='analysis'){
    showPage('analysis');
    setTimeout(()=>{const q=document.getElementById('analysisQuestion'); if(q) q.value=prompt;},80);
    return;
  }
  if(target==='panel'){
    showPage('chat');
    setTimeout(()=>{
      const agent=document.getElementById('chatAgent');
      if(agent && [...agent.options].some(o=>o.value==='agent_panel')) agent.value='agent_panel';
      askPreset(prompt);
    },80);
    return;
  }
  if(target==='codex'){
    showPage('codex');
    setTimeout(()=>{
      const title=document.getElementById('codexTitle'), body=document.getElementById('codexPrompt');
      if(title) title.value=short(prompt,64);
      if(body) body.value=`围绕“${prompt}”完善数据智能体平台体验，保持 RBAC、SQL Guard、Trace、审计和审批流不退化，并运行 python3 scripts/static_check.py。`;
    },100);
  }
}
async function openTrace(traceId){
  const trace=document.getElementById('traceBox');
  if(!traceId) return;
  if(trace) trace.innerHTML=inlineLoading('正在加载 Trace 证据');
  try{
    await loadTrace(traceId);
  }catch(e){
    currentTrace=null;
    if(trace) trace.innerHTML=stateBanner('error','Trace 加载失败',e.message);
  }
}
function evidenceSelector(target){
  const map={summary:'#trace-summary',sql:'#trace-sql',permission:'[data-step-type=\"permission\"],[data-step-type=\"sql_guard\"]',steps:'#trace-steps',result:'[data-step-type=\"sql_execution\"],#trace-sql',chart:'[data-step-type=\"sql_execution\"],#trace-steps',tools:'#trace-tools'};
  return map[target]||'#trace-summary';
}
function focusEvidenceIn(trace,target='summary'){
  const el=trace?.querySelector(evidenceSelector(target))||trace?.querySelector('#trace-summary');
  if(!el) return false;
  trace.querySelectorAll('.evidence-focus').forEach(x=>x.classList.remove('evidence-focus'));
  el.classList.add('evidence-focus');
  el.scrollIntoView({behavior:'smooth',block:'center'});
  return true;
}
function focusEvidence(target='summary'){
  return focusEvidenceIn(document.getElementById('traceBox'),target);
}
async function openEvidence(traceId,target='summary'){
  pendingEvidenceTarget=target;
  await openTrace(traceId);
}
function traceHtml(trace){
  const output=trace.output||{};
  const steps=trace.steps||[], sql=trace.sql_runs||[], tools=trace.tool_calls||[];
  return `<div id="trace-summary" class="trace-summary evidence-target">${statusTag(trace.status)}${tag(trace.agent_id||'-')}${tag(trace.agent_version||'-')}<span>${esc(output.answer_type||'answer')}</span></div>
  <div class="trace-block evidence-target" id="trace-input"><h3>输入</h3><p>${esc(trace.input)}</p></div>
  <div class="trace-block evidence-target" id="trace-sql"><h3>SQL</h3>${sql.length?sql.map((s,i)=>`<div class="sql-card evidence-target" data-sql-index="${i+1}"><pre class="code">${esc(s.sql_text)}</pre><div>${statusTag(s.status)}<span>${esc(s.row_count)} 行</span><span>${esc(s.duration_ms)}ms</span></div></div>`).join(''):emptyState('无 SQL','本次调用未触发 SQL 查询。')}</div>
  <div class="trace-block evidence-target" id="trace-tools"><h3>工具调用</h3>${tools.length?tools.map((t,i)=>`<div class="trace-item evidence-target" data-tool-index="${i+1}"><b>${esc(t.adapter_id)}</b><div>${statusTag(t.status)}<span>${esc(t.duration_ms)}ms</span></div></div>`).join(''):emptyState('无工具调用','本次结果未调用外部工具。')}</div>
  <div class="trace-block evidence-target" id="trace-steps"><h3>执行步骤</h3><div class="timeline">${steps.map(st=>`<div class="timeline-item evidence-target" data-step-type="${esc(st.step_type)}"><div class="timeline-dot">${esc(st.step_no)}</div><div><b>${esc(st.name)}</b><p>${esc(st.step_type)} / ${displayValue(st.status)}</p><details><summary>输出 JSON</summary><pre class="code">${esc(JSON.stringify(st.output_json,null,2))}</pre></details></div></div>`).join('')}</div></div>`;
}
async function openEvalTrace(traceId,target='summary',btn){
  const box=document.getElementById('evalTraceBox');
  if(!box||!traceId) return;
  setBusy(btn,true);
  box.innerHTML=inlineLoading('正在加载评测 Trace');
  try{
    const trace=await api('/api/traces/'+traceId);
    box.innerHTML=traceHtml(trace);
    requestAnimationFrame(()=>focusEvidenceIn(box,target));
  }catch(e){
    box.innerHTML=stateBanner('error','Trace 加载失败',e.message);
  }finally{
    setBusy(btn,false);
  }
}
function traceDrawer(id,title,text){
  return `<aside class="trace-drawer-inline"><div class="pane-title"><span>Trace</span><div><h2>${esc(title)}</h2><p>${esc(text)}</p></div></div><div id="${esc(id)}">${emptyState('未选择 Trace','执行查询、画像或质量检查后会显示可审计证据。')}</div></aside>`;
}
function traceActions(traceId, handler='openDataTrace'){
  return traceId?`<div class="trace-actions"><button class="report-action" onclick="${handler}('${jsArg(traceId)}','summary',this)">Trace 总览</button><button class="report-action" onclick="${handler}('${jsArg(traceId)}','sql',this)">SQL</button><button class="report-action" onclick="${handler}('${jsArg(traceId)}','permission',this)">权限</button><button class="report-action" onclick="${handler}('${jsArg(traceId)}','steps',this)">步骤</button></div>`:'';
}
async function openTraceInto(boxId,traceId,target='summary',btn,label='Trace'){
  const box=document.getElementById(boxId);
  if(!box||!traceId) return;
  setBusy(btn,true);
  box.innerHTML=inlineLoading(`正在加载${label}`);
  try{
    const trace=await api('/api/traces/'+traceId);
    box.innerHTML=traceHtml(trace);
    requestAnimationFrame(()=>focusEvidenceIn(box,target));
  }catch(e){
    box.innerHTML=stateBanner('error','Trace 加载失败',e.message);
  }finally{
    setBusy(btn,false);
  }
}
async function openDataTrace(traceId,target='summary',btn){
  return openTraceInto('dataTraceBox',traceId,target,btn,'数据操作 Trace');
}
async function openDashboardTrace(traceId,target='summary',btn){
  return openTraceInto('dashboardTraceBox',traceId,target,btn,'任务 Trace');
}
async function openPanelTrace(traceId,target='summary',btn){
  return openTraceInto('panelTraceBox',traceId,target,btn,'面板 Trace');
}
async function openCodexTrace(traceId,target='summary',btn){
  return openTraceInto('codexTraceBox',traceId,target,btn,'Codex Trace');
}
async function openAnalysisTrace(traceId,target='summary',btn){
  return openTraceInto('analysisTraceBox',traceId,target,btn,'研究 Trace');
}
async function openReportTrace(traceId,target='summary',btn){
  return openTraceInto('reportTraceBox',traceId,target,btn,'报告证据 Trace');
}
async function openAuditTrace(traceId,target='summary',btn){
  return openTraceInto('auditTraceBox',traceId,target,btn,'审计 Trace');
}
function syncChatSendControls(sending=false){
  const input=document.getElementById('chatInput');
  const send=document.getElementById('chatSendButton');
  const stop=document.getElementById('chatStopButton');
  if(input) input.disabled=sending;
  if(send){
    send.disabled=sending;
    send.classList.toggle('is-busy',sending);
  }
  if(stop){
    stop.classList.toggle('hidden',!sending);
    stop.disabled=!sending;
    stop.classList.remove('is-busy');
  }
}
function stopChatGeneration(btn){
  if(!chatSending || !chatAbortController) return;
  if(btn){
    btn.disabled=true;
    btn.classList.add('is-busy');
  }
  chatAbortController.abort();
  toast('已停止本轮生成');
}
async function sendChat(btn){
  if(chatSending){ stopChatGeneration(); return; }
  const input=document.getElementById('chatInput'); const msg=input.value.trim(); if(!msg) return; const agent_id=document.getElementById('chatAgent').value;
  chatSending=true;
  chatAbortController=new AbortController();
  const sendButton=document.getElementById('chatSendButton')||document.querySelector('#page-chat .composer-row button');
  const actionButton=btn&&btn!==sendButton?btn:null;
  setBusy(actionButton,true);
  syncChatSendControls(true);
  const box=document.getElementById('chatMessages');
  if(box.querySelector('.chat-welcome')) box.innerHTML='';
  box.innerHTML+=userMessageHtml(msg); input.value='';
  activeChatMessages.push({role:'user',content:msg,content_type:'text',created_at:new Date().toISOString()});
  syncChatBriefControls();
  const pendingId='pending-'+Date.now();
  box.innerHTML+=`<div id="${pendingId}" class="message assistant pending-message">${inlineLoading('Agent 正在路由和生成答案')}</div>`;
  try{
    const data=await api('/api/chat/query',{method:'POST',signal:chatAbortController.signal,body:JSON.stringify({message:msg,agent_id,session_id:activeSessionId||null,context:selectedChatContext()})}); const r=data.result||{};
    activeSessionId=data.session_id||activeSessionId;
    const title=document.getElementById('chatSessionTitle'); if(title) title.innerText=sessionTitle({title:msg});
    document.getElementById(pendingId)?.remove();
    box.innerHTML+=`<div class="message assistant rich-message">${resultHtml(r,{session_id:activeSessionId,trace_id:data.trace_id,question:msg})}</div>`;
    activeChatMessages.push({role:'assistant',content:JSON.stringify(r),content_type:'agent_result',created_at:new Date().toISOString()});
    if(activeSessionId) sessionSearchCache[activeSessionId]=buildSessionSearchIndex({messages:activeChatMessages});
    syncChatBriefControls();
    await openTrace(data.trace_id);
    if(!chatCanvasValue().trim()) setChatCanvasDraft(chatCanvasTemplate('report'),'已根据本轮回答生成报告要点');
    await refreshChatSessions();
  }catch(e){
    const stopped=e?.name==='AbortError';
    const banner=stopped
      ? stateBanner('warn','已停止生成','本轮请求已在浏览器侧停止；原问题保留在当前会话，可编辑、重问或分支。')
      : stateBanner('error','问数失败',e.message);
    const p=document.getElementById(pendingId);
    if(p) p.innerHTML=banner;
    else box.innerHTML+=`<div class="message assistant">${banner}</div>`;
  }
  finally{
    chatSending=false;
    chatAbortController=null;
    syncChatSendControls(false);
    setBusy(actionButton,false);
  }
  box.scrollTop=box.scrollHeight;
}
async function loadTrace(traceId){
  const trace=await api('/api/traces/'+traceId); currentTrace=trace;
  document.getElementById('traceBox').innerHTML=traceHtml(trace);
  if(pendingEvidenceTarget) requestAnimationFrame(()=>{focusEvidence(pendingEvidenceTarget); pendingEvidenceTarget='';});
}

function analysisTaskFromResponse(r){
  if(r?.task_type) return r;
  return {
    id:r?.task_id||r?.id,
    status:r?.status||'pending',
    progress:r?.status==='success'?100:10,
    result_ref:r?.trace_id||r?.result?.trace_id,
    result_json:r?.result||null,
    approvals:r?.approval_id?[{id:r.approval_id,status:'pending',reason:'plan approval required'}]:[]
  };
}
function analysisPlanHtml(plan=[]){
  const items=Array.isArray(plan)&&plan.length?plan:['确认分析目标','执行只读 SQL 查询','生成报告草稿','人工复核发布'];
  return `<div class="research-plan">${items.map((item,i)=>`<div><span>${i+1}</span><b>${esc(item)}</b><p>${i===0?'先确认目标与范围，再进入执行。':i===items.length-1?'进入报告复核，不绕过人工确认。':'执行结果会写入 Trace 和审计。'}</p></div>`).join('')}</div>`;
}
function analysisStatusFlow(status){
  const flow=[['awaiting_approval','计划审批'],['running','执行查询'],['success','报告草稿'],['review','人工复核']];
  const idx=status==='success'?2:status==='running'?1:0;
  return `<div class="mini-flow analysis-flow">${flow.map(([key,label],i)=>`<span class="${i<=idx?'done':''}">${esc(label)}</span>`).join('')}</div>`;
}
function analysisTaskHtml(task){
  const result=task.result_json||{};
  const traceId=task.result_ref||result.trace_id||'';
  const approvals=task.approvals||[];
  const hasReport=Boolean(result.report_id);
  const kind=task.status==='failed'?'error':task.status==='success'?'success':'pending';
  return `<section class="analysis-result-shell">
    ${stateBanner(kind,task.status==='success'?'研究已完成':'研究任务已创建',task.status==='success'?'报告草稿、证据和后续动作已生成。':'计划等待人工确认，审批后执行查询与报告草稿。',[task.id||'-',displayValue(task.status),traceId||'no-trace'])}
    ${analysisStatusFlow(task.status)}
    ${traceId?traceActions(traceId,'openAnalysisTrace'):''}
    <div class="grid2 section-gap">
      <div class="research-block"><h3>研究计划</h3>${analysisPlanHtml(result.plan)}${approvals.length?renderTable(approvals,{columns:['id','status','reason','created_at','decided_at'],compact:true,limit:6}):stateBanner('warn','尚无审批记录','当前任务没有返回审批明细。')}</div>
      <div class="research-block"><h3>执行输出</h3>${result.answer?`<p>${esc(result.answer)}</p>`:stateBanner('pending','等待执行输出','计划审批后会展示研究结论、证据和报告草稿。')}${hasReport?`<button class="secondary" onclick="showPage('reports');setTimeout(()=>openReportDetail('${jsArg(result.report_id)}'),120)">打开报告草稿</button>`:''}<pre class="code">${esc(JSON.stringify(result,null,2))}</pre></div>
    </div>
    ${result.report_markdown?`<div class="report research-report">${esc(result.report_markdown)}</div>`:''}
  </section>`;
}
function researchPromptExamples(){
  return ['分析本月收入变化的主要原因，并结合客户工单根因给出经营建议。','对比各渠道 ROI，找出预算转移机会，并生成复核用报告草稿。','排查华东区域收入下滑原因，结合订单、营销和工单证据。'];
}
function researchPromptButton(q){
  return `<button class="prompt-pill" onclick="document.getElementById('analysisQuestion').value='${jsArg(q)}'">${esc(q)}</button>`;
}
async function renderAnalysis(){
  const defaultAgent=agents.find(a=>a.type==='analysis')?.id||'agent_business_analysis';
  const tasks=await api('/api/tasks').catch(()=>[]);
  document.getElementById('page-analysis').innerHTML=`${pageHeader('深度研究','从一个研究 brief 出发，先生成可审批计划，再执行只读分析、证据复核和报告草稿。',['Plan approval','Evidence drawer','Report draft'])}
  <div class="analysis-workspace">
    <section class="analysis-main">
      <div class="research-composer">
        <div class="section-title"><div><h2>研究 brief</h2><p>像 ChatGPT Deep Research 一样先明确目标、上下文和输出形态，但执行仍受 RBAC、SQL Guard、Trace 和审批保护。</p></div>${tag('approval first','amber')}</div>
        <div class="form-row">
          <div><label class="field-label" for="analysisAgent">Agent</label><select id="analysisAgent">${agentOptions('analysis')}</select></div>
          <div><label class="field-label" for="analysisDatasetHint">上下文数据</label><select id="analysisDatasetHint"><option value="">自动选择</option>${datasetOptions()}</select></div>
        </div>
        <label class="field-label" for="analysisQuestion">研究问题</label>
        <textarea id="analysisQuestion">分析本月收入变化的主要原因，并结合客户工单根因给出经营建议。</textarea>
        <div class="prompt-strip">${researchPromptExamples().map(researchPromptButton).join('')}</div>
        <div class="tool-strip"><span>输出</span>${tag('计划')}${tag('SQL 证据')}${tag('报告草稿')}${tag('人工复核')}</div>
        <div class="toolbar"><button onclick="runAnalysis(this)">创建研究计划</button><button class="secondary" onclick="approveLastTask(this)">审批并执行</button><button class="ghost" onclick="loadLastAnalysisTask(this)">刷新任务</button><button class="ghost" onclick="cancelAnalysisTask(this)">取消</button></div>
      </div>
      <div id="analysisResult" class="section-gap">${emptyState('等待研究 brief','创建研究计划后，这里会显示计划、审批、执行结果和报告草稿入口。')}</div>
    </section>
    <aside class="analysis-side">
      ${traceDrawer('analysisTraceBox','研究证据','查看计划、SQL、权限检查、工具调用和报告草稿生成步骤。')}
      ${taskQueuePanel(tasks.filter(t=>(t.task_type||'').includes('analysis')).concat(tasks.filter(t=>!(t.task_type||'').includes('analysis')).slice(0,4)),{title:'研究任务队列',description:'从历史任务恢复上下文，继续审批、刷新或打开 Trace。',detailId:'analysisTaskDetail',traceHandler:'openAnalysisTrace',limit:6})}
      <div class="research-playbook card section-gap"><h3>研究编排</h3>${workflowRail([['Brief','明确问题、范围和输出形态'],['Plan','生成可审批研究计划'],['Evidence','执行只读 SQL 和补充工具调用'],['Draft','产出报告草稿并进入报告中心']])}<div class="approval-banner section-gap"><b>安全边界</b><span>深度研究不会绕过审批、RBAC、SQL Guard、Trace 或报告复核。</span></div></div>
    </aside>
  </div>`;
  const sel=document.getElementById('analysisAgent');
  if(sel&&[...sel.options].some(o=>o.value===defaultAgent)) sel.value=defaultAgent;
}
async function runAnalysis(btn){
  const resultBox=document.getElementById('analysisResult');
  setBusy(btn,true); resultBox.innerHTML=inlineLoading('正在创建研究计划');
  try{
    const question=analysisQuestion.value.trim();
    const contextHint=analysisDatasetHint.value?` 数据上下文：${datasetName(analysisDatasetHint.value)}。`:'';
    const r=await api('/api/analysis/tasks',{method:'POST',body:JSON.stringify({question:question+contextHint,agent_id:analysisAgent.value,require_plan_approval:true})});
    lastAnalysisTaskId=r.task_id||r.id;
    const task=analysisTaskFromResponse(r);
    resultBox.innerHTML=analysisTaskHtml(task);
    if(task.result_ref) openAnalysisTrace(task.result_ref,'steps',null).catch(()=>{});
  }catch(e){
    resultBox.innerHTML=stateBanner('error','研究任务创建失败',e.message);toast(e.message);
  }finally{setBusy(btn,false)}
}
async function loadLastAnalysisTask(btn){
  if(!lastAnalysisTaskId) return toast('暂无任务');
  const resultBox=document.getElementById('analysisResult');
  setBusy(btn,true); resultBox.innerHTML=inlineLoading('正在读取研究任务');
  try{
    const task=await api('/api/analysis/tasks/'+lastAnalysisTaskId);
    resultBox.innerHTML=analysisTaskHtml(task);
    if(task.result_ref) openAnalysisTrace(task.result_ref,'summary',null).catch(()=>{});
  }catch(e){
    resultBox.innerHTML=stateBanner('error','任务读取失败',e.message);toast(e.message);
  }finally{setBusy(btn,false)}
}
async function approveLastTask(btn){
  if(!lastAnalysisTaskId)return toast('暂无任务');
  const resultBox=document.getElementById('analysisResult');
  setBusy(btn,true); resultBox.innerHTML=inlineLoading('正在审批并执行研究计划');
  try{
    const r=await api(`/api/analysis/tasks/${lastAnalysisTaskId}/approve-plan`,{method:'POST',body:JSON.stringify({comment:'页面审批'})});
    const task=analysisTaskFromResponse(r);
    resultBox.innerHTML=analysisTaskHtml(task);
    if(task.result_ref) openAnalysisTrace(task.result_ref,'steps',null).catch(()=>{});
  }catch(e){
    resultBox.innerHTML=stateBanner('error','审批失败',e.message);toast(e.message);
  }finally{setBusy(btn,false)}
}
async function cancelAnalysisTask(btn){
  if(!lastAnalysisTaskId)return toast('暂无任务');
  setBusy(btn,true);
  try{
    await api(`/api/analysis/tasks/${lastAnalysisTaskId}/cancel`,{method:'POST'});
    document.getElementById('analysisResult').innerHTML=stateBanner('warn','研究任务已取消','任务状态已写入审计日志。',[lastAnalysisTaskId]);
  }catch(e){
    document.getElementById('analysisResult').innerHTML=stateBanner('error','取消失败',e.message);
  }finally{setBusy(btn,false)}
}

async function renderPanels(){
  const panels=await api('/api/data/panels').catch(()=>[]);
  panelCatalogCache=panels;
  const pid=activePanelId || panels[0]?.id || 'panel_business_overview';
  let panel=await api('/api/data/panels/'+pid).catch(()=>null);
  if(panel) activePanelId=panel.id;
  const options=panels.length?panels.map(p=>`<option value="${esc(p.id)}">${esc(p.name)}</option>`).join(''):(panel?`<option value="${esc(panel.id)}">${esc(panel.name)}</option>`:'');
  const prompt='给我生成一个经营总览面板';
  document.getElementById('page-panels').innerHTML=`${pageHeader('分析面板','以物化经营面板承接问数结果，展示指标卡、Top 图、风险图和生成 SQL。',['Widgets','Materialized view','Agent generated'])}
  <div class="panel-toolbar"><select id="panelSelect" aria-label="选择分析面板" ${options?'':'disabled'}>${options}</select><button onclick="renderPanelDetail()" ${options?'':'disabled'}>打开面板</button><button class="secondary" onclick="showPage('chat');setTimeout(()=>askPreset('${jsArg(prompt)}'),50)">让 Agent 生成</button></div>
  <div class="panel-builder-grid section-gap">
    <section class="panel-builder-card">
      <div class="section-title"><div><h2>面板 brief</h2><p>从业务目标创建空面板，后续 Widget 通过 SQL Guard 预校验再保存。</p></div>${tag('panel:manage','amber')}</div>
      <label class="field-label" for="panelName">名称</label><input id="panelName" value="经营专题面板"/>
      <div class="form-row"><div><label class="field-label" for="panelDomain">业务域</label><input id="panelDomain" value="Business"/></div><div><label class="field-label" for="panelTemplate">起点</label><select id="panelTemplate" onchange="syncPanelTemplate()"><option value="revenue">收入分析</option><option value="risk">风险监控</option><option value="ops">运营效率</option></select></div></div>
      <label class="field-label" for="panelDescription">说明</label><textarea id="panelDescription">面向经营复盘的可审计分析面板，包含指标卡、趋势图和异常下钻入口。</textarea>
      <button onclick="createPanel(this)">创建面板</button><div id="panelCreateResult"></div>
    </section>
    <section class="panel-builder-card">
      <div class="section-title"><div><h2>Widget 设计器</h2><p>选择目标面板、数据集和图表类型；保存前后端会用只读 SQL 预跑 1 行。</p></div>${tag('SQL Guard','green')}</div>
      <label class="field-label" for="panelWidgetPanel">目标面板</label><select id="panelWidgetPanel">${panelOptions(panels,panel?.id)}</select>
      <div class="form-row"><div><label class="field-label" for="panelWidgetDataset">数据集</label><select id="panelWidgetDataset" onchange="syncPanelWidgetDraft()">${datasetOptions(defaultQueryDataset())}</select></div><div><label class="field-label" for="panelWidgetType">类型</label><select id="panelWidgetType" onchange="syncPanelWidgetDraft()"><option value="metric_card">指标卡</option><option value="bar">柱状图</option><option value="line">趋势图</option><option value="table">表格</option></select></div></div>
      <div class="form-row"><div><label class="field-label" for="panelWidgetMetric">指标</label><select id="panelWidgetMetric">${metricOptions('',defaultQueryDataset())}</select></div><div><label class="field-label" for="panelWidgetTitle">标题</label><input id="panelWidgetTitle" value="收入 Top 分布"/></div></div>
      <label class="field-label" for="panelWidgetSql">只读 SQL</label><textarea id="panelWidgetSql">${esc(sampleSqlForDataset(defaultQueryDataset()))}</textarea>
      <button onclick="createPanelWidget(this)">保存 Widget</button><div id="panelWidgetResult"></div>
    </section>
  </div>
  <div id="panelDetail">${panel?panelHtml(panel):emptyState('暂无面板','当前没有可展示的分析面板。')}</div>`;
  if(panel) document.getElementById('panelSelect').value=pid;
  syncPanelWidgetDraft();
  if(panel?.trace_id) openPanelTrace(panel.trace_id,'sql',null).catch(()=>{});
}
function panelOptions(panels=[], selected=''){
  return panels.length?panels.map(p=>`<option value="${esc(p.id)}" ${p.id===selected?'selected':''}>${esc(p.name)}</option>`).join(''):'<option value="">暂无面板</option>';
}
function syncPanelTemplate(){
  const tpl=document.getElementById('panelTemplate')?.value;
  const name=document.getElementById('panelName');
  const desc=document.getElementById('panelDescription');
  const map={
    revenue:['收入增长分析面板','围绕收入、订单、渠道和区域表现构建可审计面板。'],
    risk:['经营风险监控面板','聚合区域风险、工单根因和数据质量异常，支持 Trace 下钻。'],
    ops:['运营效率复盘面板','跟踪订单处理、工单闭环、营销 ROI 和关键运营效率指标。']
  };
  if(map[tpl]&&name&&!name.dataset.touched) name.value=map[tpl][0];
  if(map[tpl]&&desc&&!desc.dataset.touched) desc.value=map[tpl][1];
}
function syncPanelWidgetDraft(){
  const ds=document.getElementById('panelWidgetDataset');
  const metric=document.getElementById('panelWidgetMetric');
  const type=document.getElementById('panelWidgetType')?.value||'bar';
  const title=document.getElementById('panelWidgetTitle');
  const sql=document.getElementById('panelWidgetSql');
  const metricList=metricOptions(metric?.value||'',ds?.value||'');
  if(metric) metric.innerHTML=metricList || '<option value="">不绑定指标</option>';
  const dsName=datasetName(ds?.value);
  if(title&&!title.value) title.value=type==='metric_card'?`${dsName} 核心指标`:`${dsName} 分布`;
  if(sql) sql.value=sampleSqlForDataset(ds?.value||defaultQueryDataset());
}
async function createPanel(btn){
  const box=document.getElementById('panelCreateResult');
  setBusy(btn,true);
  if(box) box.innerHTML=inlineLoading('正在创建面板');
  try{
    const payload={name:panelName.value,business_domain:panelDomain.value,description:panelDescription.value};
    const panel=await api('/api/data/panels',{method:'POST',body:JSON.stringify(payload)});
    activePanelId=panel.id;
    toast('面板已创建');
    await renderPanels();
    document.getElementById('panelCreateResult').innerHTML=stateBanner('success','面板已创建','可以继续添加 Widget，保存前会执行 SQL Guard 预校验。',[panel.id]);
  }catch(e){
    if(box) box.innerHTML=stateBanner('error','面板创建失败',e.message);
    toast('面板创建失败：'+e.message);
  }finally{setBusy(btn,false)}
}
async function createPanelWidget(btn){
  const box=document.getElementById('panelWidgetResult');
  const panelId=document.getElementById('panelWidgetPanel')?.value||activePanelId;
  if(!panelId) return toast('请先选择或创建面板');
  setBusy(btn,true);
  if(box) box.innerHTML=inlineLoading('正在校验并保存 Widget');
  try{
    const datasetId=document.getElementById('panelWidgetDataset')?.value||null;
    const widgetType=document.getElementById('panelWidgetType')?.value||'bar';
    const payload={
      panel_id:panelId,
      widget_type:widgetType,
      title:panelWidgetTitle.value,
      dataset_id:datasetId,
      metric_id:panelWidgetMetric.value||null,
      query_sql:panelWidgetSql.value,
      chart_spec:{chart_type:widgetType==='metric_card'?'number':widgetType},
      position_json:{columns:6}
    };
    const widget=await api(`/api/data/panels/${panelId}/widgets`,{method:'POST',body:JSON.stringify(payload)});
    activePanelId=panelId;
    toast('Widget 已保存');
    await renderPanels();
    document.getElementById('panelWidgetResult').innerHTML=stateBanner('success','Widget 已保存','后端已完成只读 SQL 预校验，并刷新面板物化结果。',[widget.id,panelId]);
  }catch(e){
    if(box) box.innerHTML=stateBanner('error','Widget 保存失败',e.message);
    toast('Widget 保存失败：'+e.message);
  }finally{setBusy(btn,false)}
}
async function renderPanelDetail(){
  const select=document.getElementById('panelSelect');
  if(!select?.value) return;
  activePanelId=select.value;
  const widgetPanel=document.getElementById('panelWidgetPanel');
  if(widgetPanel) widgetPanel.value=select.value;
  document.getElementById('panelDetail').innerHTML=inlineLoading('正在物化面板数据');
  try{
    const panel=await api('/api/data/panels/'+select.value);
    document.getElementById('panelDetail').innerHTML=panelHtml(panel);
    if(panel.trace_id) openPanelTrace(panel.trace_id,'sql',null).catch(()=>{})
  }catch(e){
    document.getElementById('panelDetail').innerHTML=stateBanner('error','面板加载失败',e.message)
  }
}
function panelWidgetHtml(w){
  const error=widgetHasError(w);
  const chartType=widgetChartType(w);
  const rows=w.rows||[];
  const rowCount=error?0:rows.length;
  const meta=[datasetName(w.dataset_id),metricName(w.metric_id),widgetTypeLabel(w)].filter(Boolean);
  const chartSpec=Object.assign({},w.chart_spec||{},{data:rows,x:Object.keys(rows[0]||{})[0],y:Object.keys(rows[0]||{})[1]});
  return `<article class="widget-card ${w.widget_type==='metric_card'?'metric-widget':''} ${error?'widget-error':''}">
    <div class="card-heading"><div><h3>${esc(w.title)}</h3><div class="widget-meta">${meta.map(m=>tag(m)).join('')}</div></div>${error?statusTag('failed'):tag(widgetTypeLabel(w))}</div>
    ${error?stateBanner('error','Widget 查询失败',widgetErrorText(w)):w.widget_type==='metric_card'?`<div class="widget-value"><span>${esc(displayValue(rowPrimaryValue(rows)))}</span><small>${esc(metricName(w.metric_id))}</small></div><div class="muted">由只读 SQL 物化生成，结果 ${esc(rowCount)} 行。</div>`:renderChart({title:w.title,spec:chartSpec})}
    <div class="widget-foot"><span>${esc(rowCount)} rows</span><span>${esc(timeText(w.created_at))}</span></div>
    <details><summary>SQL 与布局</summary><pre class="code">${esc(w.query_sql||'未配置 SQL')}</pre><div class="widget-json">${compactTags([`dataset: ${datasetName(w.dataset_id)}`,`metric: ${metricName(w.metric_id)}`,`chart: ${chartType}`],3)}</div></details>
  </article>`;
}
function panelHtml(panel){
  const widgets=panel.widgets||[];
  const failed=widgets.filter(widgetHasError).length;
  return `<div class="panel-workspace section-gap">
    <section class="panel-shell">
      <div class="panel-title"><div><h2>${esc(panel.name)}</h2><p>${esc(panel.description||'')}</p><div class="panel-meta">${tag(panel.business_domain||'Business')}${statusTag(panel.status||'draft')}${panel.trace_id?tag(panel.trace_id):''}${failed?tag(`${failed} failed`,'red'):tag('SQL Guard','green')}</div></div>${tag(`${widgets.length} widgets`)}</div>
      ${panel.trace_id?traceActions(panel.trace_id,'openPanelTrace'):''}
      ${panelCockpit(panel)}
      <div class="panel-grid">${widgets.length?widgets.map(panelWidgetHtml).join(''):emptyState('暂无 Widget','该面板还没有配置可物化的图表或指标卡。')}</div>
    </section>
    ${traceDrawer('panelTraceBox','面板证据','复核面板物化 SQL、数据集权限、SQL Guard 和 Widget 生成步骤。')}
  </div>`;
}

function renderDatasetCatalog(){
  const filtered=datasets.filter(datasetMatches);
  const grid=document.getElementById('dataCatalogGrid');
  if(grid) grid.innerHTML=filtered.length?filtered.map(datasetCard).join(''):emptyState('没有匹配数据集','调整搜索、业务域、分级或刷新模式。');
  const count=document.getElementById('dataCatalogResultCount');
  if(count) count.innerText=`显示 ${filtered.length} / ${datasets.length}`;
  const metricBox=document.getElementById('dataCatalogMetricsTable');
  if(metricBox){
    const ids=new Set(filtered.map(d=>d.id));
    const names=new Set(filtered.map(d=>d.name));
    const scopedMetrics=metrics.filter(m=>ids.has(m.dataset_id)||names.has(m.dataset_name));
    metricBox.innerHTML=renderTable(scopedMetrics,{columns:['name','code','dataset_name','formula','time_grain','status'],limit:80,emptyTitle:'暂无匹配指标',emptyText:'当前筛选结果下没有关联指标口径。'});
  }
  if(activeDatasetId && !filtered.some(d=>d.id===activeDatasetId)){
    activeDatasetId=filtered[0]?.id||'';
    if(activeDatasetId) openDatasetDetail(activeDatasetId,null).catch(()=>{});
    else{
      const box=document.getElementById('datasetDetail');
      if(box) box.innerHTML=emptyState('没有匹配数据集','调整筛选后会恢复数据集详情。');
    }
  }else if(!activeDatasetId && filtered[0]){
    activeDatasetId=filtered[0].id;
    openDatasetDetail(activeDatasetId,null).catch(()=>{});
  }
}
function setDataCatalogFilter(key,value){
  dataCatalogFilterState[key]=value;
  renderDatasetCatalog();
}
function resetDataCatalogFilters(){
  dataCatalogFilterState={q:'',domain:'all',classification:'all',refresh:'all'};
  const q=document.getElementById('dataCatalogSearch');
  if(q) q.value='';
  ['dataCatalogDomainFilter','dataCatalogClassFilter','dataCatalogRefreshFilter'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value='all';
  });
  renderDatasetCatalog();
}
function setDatasetChatDraft(id){
  const dataset=datasets.find(d=>d.id===id)||{id,name:id};
  setChatDraft(`基于数据集“${dataset.name||id}”回答：这个数据集能支持哪些经营分析？请给出关键指标、可追问问题和需要注意的数据分级。`,'agent_router',id);
}
function setDatasetAnalysisDraft(id){
  const dataset=datasets.find(d=>d.id===id)||{id,name:id};
  setAnalysisDraft(`围绕数据集“${dataset.name||id}”做深度研究：梳理可回答的业务问题、关联指标、字段质量风险、敏感字段处理和下一步治理建议。`,'agent_business_analysis');
}
async function openDatasetDetail(id,btn){
  const box=document.getElementById('datasetDetail');
  if(!box) return;
  activeDatasetId=id;
  document.querySelectorAll('.asset-card[data-dataset-id]').forEach(card=>card.classList.toggle('active',card.dataset.datasetId===id));
  setBusy(btn,true);
  box.innerHTML=inlineLoading('正在读取数据集字段和操作入口');
  try{
    const dataset=datasets.find(d=>d.id===id)||{id};
    const fields=await api('/api/datasets/'+id+'/fields').catch(()=>[]);
    const relatedMetrics=metrics.filter(m=>m.dataset_id===id||m.dataset_name===dataset.name);
    const datasetTitle=dataset.name||id;
    const contextActions=contextActionStrip([
      {label:'用此数据集问数',onclick:`setDatasetChatDraft('${jsArg(id)}')`},
      {label:'转深度研究',onclick:`setDatasetAnalysisDraft('${jsArg(id)}')`},
      {label:'加入工作包',onclick:`addDatasetToContextPack('${jsArg(id)}',this)`},
      {label:'创建治理任务',onclick:`setCodexDraft('${jsArg(`治理数据集：${datasetTitle}`)}','${jsArg(`检查数据集 ${id} 的目录展示、字段说明、指标口径、数据分级、SQL Guard、画像、质量规则和 Trace 证据链，保持 RBAC、masking 和审计能力不退化。`)}')`}
    ]);
    box.innerHTML=`<div class="dataset-detail">
      <div class="card-heading"><div><h3>${esc(dataset.name||id)}</h3><p class="muted">${esc(dataset.physical_table||id)} · ${esc(dataset.business_domain||'-')}</p></div>${statusTag(dataset.data_classification||'internal')}</div>
      <p>${esc(dataset.description||'暂无数据集说明')}</p>
      ${contextActions}
      <div class="dataset-actions"><button onclick="dataTab('query',document.querySelector('#page-dataops .tabs button[data-tab=&quot;query&quot;]'));setTimeout(()=>{document.getElementById('qDataset').value='${jsArg(id)}';syncWorkbenchSql()},60)">打开 SQL Workbench</button><button class="secondary" onclick="dataTab('profile',document.querySelector('#page-dataops .tabs button[data-tab=&quot;profile&quot;]'));setTimeout(()=>{document.getElementById('profileDataset').value='${jsArg(id)}'},60)">生成画像</button><button class="ghost" onclick="dataTab('quality',document.querySelector('#page-dataops .tabs button[data-tab=&quot;quality&quot;]'));setTimeout(()=>{const q=document.getElementById('qualityDataset'); if(q) q.value='${jsArg(id)}'},80)">运行质量规则</button></div>
      <div class="metric-grid tight">${metricCard('字段',fields.length,'已登记字段')}${metricCard('指标',relatedMetrics.length,'关联口径')}${metricCard('刷新',dataset.refresh_mode||'-','数据刷新策略')}${metricCard('分级',dataset.data_classification||'-','权限和 masking 输入')}</div>
      <h4>字段</h4>${renderTable(fields,{columns:['field_name','display_name','data_type','description','is_sensitive','masking_policy'],compact:true,limit:60})}
      <h4>关联指标</h4>${relatedMetrics.length?renderTable(relatedMetrics,{columns:['name','code','formula','time_grain','status'],compact:true,limit:40}):emptyState('暂无指标','该数据集还没有可见指标口径。')}
    </div>`;
  }catch(e){
    box.innerHTML=stateBanner('error','数据集详情加载失败',e.message);
  }finally{setBusy(btn,false)}
}
async function renderDataOps(){
  document.getElementById('page-dataops').innerHTML=`${pageHeader('数据能力','把数据目录、指标口径、只读 SQL、画像、质量规则和导入入口集中到一个治理面。',['Dataset Catalog','Metrics','SQL Guard'])}
  <div class="tabs segmented"><button class="active" data-tab="catalog" onclick="dataTab('catalog',this)">数据目录</button><button data-tab="query" onclick="dataTab('query',this)">SQL Workbench</button><button data-tab="profile" onclick="dataTab('profile',this)">数据画像</button><button data-tab="quality" onclick="dataTab('quality',this)">数据质量</button><button data-tab="quality-history" onclick="dataTab('quality-history',this)">质量历史</button><button data-tab="import" onclick="dataTab('import',this)">CSV 导入</button></div><div id="dataTab"></div>`;
  dataTab('catalog',document.querySelector('#page-dataops .tabs button[data-tab="catalog"]'));
}
async function dataTab(name,btn){document.querySelectorAll('#page-dataops .tabs button').forEach(b=>b.classList.remove('active')); if(btn)btn.classList.add('active'); const box=document.getElementById('dataTab');
  if(name==='catalog'){const filtered=datasets.filter(datasetMatches);activeDatasetId=activeDatasetId||filtered[0]?.id||datasets[0]?.id||'';box.innerHTML=`<div class="metric-grid tight">${metricCard('数据集',datasets.length,'已注册业务数据资产')}${metricCard('指标',metrics.length,'可复用口径与语义')}${metricCard('敏感数据集',datasets.filter(d=>d.data_classification==='confidential').length,'需保持 masking 与 RBAC')}${metricCard('业务域',new Set(datasets.map(d=>d.business_domain).filter(Boolean)).size,'跨域治理范围')}</div><div class="data-catalog-workspace section-gap"><section><div class="section-title"><div><h2>数据资产库</h2><p>像会话历史一样搜索和筛选数据上下文，并把关联指标同步到下方口径表。</p></div>${tag(`${datasets.length} datasets`)}</div>${dataCatalogFilterBar(filtered)}<div id="dataCatalogGrid" class="asset-grid"></div><div class="card section-gap"><div class="card-heading"><h3>关联指标口径</h3>${tag('scoped by catalog')}</div><div id="dataCatalogMetricsTable"></div></div></section><aside id="datasetDetail" class="dataset-detail-card">${emptyState('选择数据集','点击数据集卡片的详情按钮查看字段、指标和后续动作。')}</aside></div>`; renderDatasetCatalog(); if(activeDatasetId) openDatasetDetail(activeDatasetId,null).catch(()=>{});}
  if(name==='query'){const defaultDs=defaultQueryDataset();box.innerHTML=`<div class="dataops-trace-layout"><div class="card form-shell"><h3>只读 SQL Workbench</h3><p class="muted">查询会经过 SQL Guard，只允许只读语句，结果保留 Trace。</p><label class="field-label" for="qDataset">数据集</label><select id="qDataset" onchange="syncWorkbenchSql()">${datasetOptions(defaultDs)}</select><label class="field-label" for="qSql">SQL</label><textarea id="qSql">${esc(sampleSqlForDataset(defaultDs))}</textarea><button onclick="runSqlWorkbench(this)">执行查询</button><div id="sqlResult"></div></div>${traceDrawer('dataTraceBox','SQL Guard 证据','复核只读 SQL、权限检查和执行步骤。')}<div class="card guard-card"><h3>执行护栏</h3><div class="stepper"><span>Read-only SQL</span><span>SQL Guard</span><span>Dataset Masking</span><span>Trace</span></div><p>适合验证业务口径、抽样分析和面板 SQL，不用于写入或绕过权限。</p></div></div>`;}
  if(name==='profile'){box.innerHTML=`<div class="dataops-trace-layout"><div class="card form-shell"><h3>数据画像</h3><p class="muted">快速查看行数、字段数量、字段画像和样本记录。</p><label class="field-label" for="profileDataset">数据集</label><select id="profileDataset">${datasetOptions()}</select><button onclick="runProfile(this)">生成画像</button><div id="profileResult"></div></div>${traceDrawer('dataTraceBox','画像证据','查看画像任务、权限范围和执行输出。')}</div>`;}
  if(name==='quality'){const rules=await api('/api/data/quality-rules').catch(()=>[]);box.innerHTML=`<div class="dataops-trace-layout"><div class="card"><h3>数据业务规则</h3>${renderTable(rules,{columns:['name','dataset_name','severity','status','description'],limit:80})}<div class="form-row section-gap"><select id="qualityDataset"><option value="">全部数据集</option>${datasetOptions()}</select><button onclick="runQuality(this)">运行规则</button></div><div id="qualityResult"></div></div>${traceDrawer('dataTraceBox','质量证据','复核运行规则、失败行统计和审计 Trace。')}</div>`;}
  if(name==='quality-history'){const rows=await api('/api/data/quality-results?limit=160').catch(()=>[]);box.innerHTML=qualityHistoryHtml(rows); if(rows[0]?.trace_id) openDataTrace(rows[0].trace_id,'steps',null).catch(()=>{});}
  if(name==='import'){box.innerHTML=`<div class="card form-shell"><h3>CSV 导入</h3><p class="muted">导入后会刷新数据目录；生产环境仍需遵循数据分级和权限策略。</p><div class="form-row"><input id="csvName" value="导入数据集" aria-label="数据集名称"/><input id="csvDomain" value="Imported" aria-label="业务域"/></div><input id="csvFile" type="file" accept=".csv"/><button onclick="importCsv(this)">上传 CSV</button><div id="importResult"></div></div>`;}
}
function qualityHistoryCard(row,index){
  const samples=Array.isArray(row.sample_rows)?row.sample_rows:[];
  return `<article class="quality-run-card ${statusClass(row.status)}">
    <div class="quality-run-head"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(row.rule_name||row.rule_id)}</b><p>${esc(row.dataset_name||row.dataset_id)} · ${esc(timeText(row.created_at))}</p></div>${statusTag(row.status)}</div>
    <div class="quality-run-metrics">${tag(`${row.checked_rows??0} checked`)}${tag(`${row.failed_rows??0} failed`,Number(row.failed_rows)>0?'red':'green')}${statusTag(row.severity||'medium')}</div>
    ${row.trace_id?traceActions(row.trace_id):stateBanner('warn','暂无 Trace','该历史记录没有 trace_id。')}
    <details><summary>失败样本 ${samples.length}</summary>${samples.length?renderTable(samples,{limit:8,compact:true,meta:false}):emptyState('暂无样本','该规则未返回失败样本。')}</details>
  </article>`;
}
function qualityHistoryHtml(rows=[]){
  const failedRows=rows.reduce((sum,r)=>sum+Number(r.failed_rows||0),0);
  const failedRuns=rows.filter(r=>Number(r.failed_rows||0)>0||r.status==='failed').length;
  const datasetsCount=new Set(rows.map(r=>r.dataset_id).filter(Boolean)).size;
  const latest=rows[0]?.created_at?timeText(rows[0].created_at):'-';
  return `<div class="quality-history-grid">
    <section class="ops-main">
      <div class="section-title"><div><h2>质量历史</h2><p>从最近质量运行回看失败行、规则级别和 Trace 证据，形成数据治理闭环。</p></div>${tag(`${rows.length} runs`)}</div>
      <div class="metric-grid tight">${metricCard('运行记录',rows.length,'权限范围内最近结果')}${metricCard('异常行',failedRows,'failed_rows 汇总')}${metricCard('异常运行',failedRuns,'需复核规则')}${metricCard('数据集',datasetsCount,'受影响资产')}${metricCard('最近运行',latest,'按创建时间倒序')}</div>
      <div class="quality-run-list">${rows.length?rows.slice(0,24).map(qualityHistoryCard).join(''):emptyState('暂无质量历史','运行数据质量规则后会在这里展示历史记录。')}</div>
      <div class="card section-gap"><h3>历史明细</h3>${renderTable(rows,{columns:['created_at','dataset_name','rule_name','status','checked_rows','failed_rows','severity','trace_id'],limit:80})}</div>
    </section>
    ${traceDrawer('dataTraceBox','质量历史 Trace','点击任一历史记录的 Trace 按钮复核规则运行、失败行统计和权限步骤。')}
  </div>`;
}
async function runSqlWorkbench(btn){setBusy(btn,true);document.getElementById('sqlResult').innerHTML=inlineLoading('正在通过 SQL Guard 执行只读查询');try{const r=await api('/api/data/query',{method:'POST',body:JSON.stringify({dataset_id:qDataset.value,sql:qSql.value,max_rows:200})});document.getElementById('sqlResult').innerHTML=`${stateBanner('success','查询完成','SQL Guard 已放行，只读结果已返回。',[r.trace_id||'no-trace'])}${traceActions(r.trace_id)}${renderTable(r.rows||[])}<div class="muted">Trace: ${esc(r.trace_id)}</div>`; if(r.trace_id) openDataTrace(r.trace_id,'sql',null).catch(()=>{});}catch(e){document.getElementById('sqlResult').innerHTML=stateBanner('error','查询被拒绝或执行失败',e.message)}finally{setBusy(btn,false)}}
async function runProfile(btn){setBusy(btn,true);document.getElementById('profileResult').innerHTML=inlineLoading('正在生成字段画像');try{const r=await api('/api/data/profile/'+profileDataset.value);document.getElementById('profileResult').innerHTML=`${stateBanner('success','画像已生成','字段统计、样本和敏感字段提示已返回。',[r.dataset.name,r.trace_id||'no-trace'])}${traceActions(r.trace_id)}<div class="kpi-row"><div class="kpi"><div class="muted">数据集</div><b>${esc(r.dataset.name)}</b></div><div class="kpi"><div class="muted">行数</div><b>${r.row_count}</b></div><div class="kpi"><div class="muted">字段</div><b>${(r.fields||[]).length}</b></div></div><h3>字段画像</h3>${renderTable(r.fields||[])}<h3>样本</h3>${renderTable(r.sample_rows||[])}`; if(r.trace_id) openDataTrace(r.trace_id,'summary',null).catch(()=>{});}catch(e){document.getElementById('profileResult').innerHTML=stateBanner('error','画像生成失败',e.message)}finally{setBusy(btn,false)}}
async function runQuality(btn){setBusy(btn,true);document.getElementById('qualityResult').innerHTML=inlineLoading('正在运行数据质量规则');try{const r=await api('/api/data/quality/run',{method:'POST',body:JSON.stringify({dataset_id:qualityDataset.value||null,rule_ids:[]})});document.getElementById('qualityResult').innerHTML=`${stateBanner('success','质量规则已运行','结果已写入 Trace，可继续复核失败行和规则级别。',[r.trace_id||'no-trace'])}${traceActions(r.trace_id)}${renderTable((r.results||[]).map(x=>({rule:x.rule.name,dataset:x.dataset.name,status:x.status,checked_rows:x.checked_rows,failed_rows:x.failed_rows,severity:x.rule.severity})))}`; if(r.trace_id) openDataTrace(r.trace_id,'steps',null).catch(()=>{});}catch(e){document.getElementById('qualityResult').innerHTML=stateBanner('error','质量检查失败',e.message)}finally{setBusy(btn,false)}}
async function importCsv(btn){if(!csvFile.files[0]){document.getElementById('importResult').innerHTML=stateBanner('warn','请选择 CSV 文件','上传前需要选择一个本地 .csv 文件。');return toast('请选择 CSV 文件')} setBusy(btn,true);document.getElementById('importResult').innerHTML=inlineLoading('正在上传并刷新数据目录');try{const fd=new FormData();fd.append('file',csvFile.files[0]); const url=`/api/data/import/csv?dataset_name=${encodeURIComponent(csvName.value)}&business_domain=${encodeURIComponent(csvDomain.value)}`; const r=await api(url,{method:'POST',body:fd,headers:{}});document.getElementById('importResult').innerHTML=`${stateBanner('success','CSV 已导入','数据目录已刷新，仍需遵守数据分级和权限策略。',[r.dataset_id||'dataset'])}<pre class="code">${esc(JSON.stringify(r,null,2))}</pre>`; await refreshCatalog();}catch(e){document.getElementById('importResult').innerHTML=stateBanner('error','CSV 导入失败',e.message)}finally{setBusy(btn,false)}}

function semanticTermCard(t){
  const synonyms=asList(t.synonyms);
  const binding=[t.canonical_object_type,t.canonical_object_id].filter(Boolean).join(' / ')||'未绑定标准对象';
  return `<article class="semantic-card">
    <div class="semantic-card-head"><div><span>${esc(t.business_domain||'Domain')}</span><b>${esc(t.term||t.id)}</b></div>${statusTag(t.status||'published')}</div>
    <p>${esc(t.definition||'暂无定义')}</p>
    <div class="semantic-meta">${tag(displayValue(t.term_type||'term'))}${tag(binding)}${compactTags(synonyms,4)}</div>
  </article>`;
}
function queryTemplateCard(t){
  const examples=asList(t.example_questions);
  return `<article class="template-card">
    <div class="template-head"><div><span>${esc(t.business_domain||'Domain')} · ${esc(displayValue(t.intent||'query'))}</span><b>${esc(t.name||t.id)}</b></div>${tag(t.chart_type||'table','green')}</div>
    <p>${esc(t.template_text||'暂无模板问题')}</p>
    <div class="template-examples">${examples.length?examples.slice(0,3).map(q=>`<button class="prompt-pill" onclick="showPage('chat');setTimeout(()=>askPreset('${jsArg(q)}'),40)">${esc(q)}</button>`).join(''):emptyState('暂无示例','该模板还没有配置示例问题。')}</div>
    <details><summary>查看 SQL 模板</summary><pre class="code">${esc(t.sql_template||'未配置 SQL 模板')}</pre></details>
  </article>`;
}
function coverageDebt(cov){
  const missing=cov.missing_metric_terms||[];
  return `<div class="coverage-debt">
    <div class="section-title"><div><h2>覆盖缺口</h2><p>优先补齐指标术语与字段说明，减少业务问数歧义。</p></div>${missing.length?tag(`${missing.length} metrics`,'amber'):tag('closed','green')}</div>
    <div class="debt-grid">
      <div class="debt-card"><span>缺少术语的指标</span><b>${esc(missing.length)}</b><p>${missing.length?'建议绑定 semantic_terms':'当前指标均已绑定术语'}</p></div>
      <div class="debt-card"><span>字段说明缺口</span><b>${esc(cov.field_desc_missing_count??0)}</b><p>${esc(cov.field_count??0)} 个字段纳入覆盖统计</p></div>
    </div>
    ${missing.length?renderTable(missing,{columns:['name','code','dataset_id','formula','status'],limit:20,compact:true}):stateBanner('success','语义覆盖完整','当前可见指标均已绑定业务术语。')}
  </div>`;
}
function semanticDomainSummary(terms,templates){
  const combined=[...(terms||[]),...(templates||[])];
  const domains=topCounts(combined,'business_domain',6);
  return `<div class="semantic-domain">
    <div class="section-title"><div><h2>业务域分布</h2><p>术语与查询模板按业务域组织，方便复用。</p></div></div>
    <div class="audit-bars">${domains.length?domains.map(([name,count])=>`<div class="audit-bar-row"><span>${esc(name)}</span><div><i style="width:${Math.max(8,Math.round(count/Math.max(1,combined.length)*100))}%"></i></div><b>${esc(count)}</b></div>`).join(''):emptyState('暂无业务域','没有可统计的语义资产。')}</div>
  </div>`;
}
function semanticTermForm(cov){
  const missing=cov.missing_metric_terms||[];
  const options=missing.length?missing.map(m=>`<option value="${esc(m.id)}" data-name="${esc(m.name)}" data-domain="${esc(m.business_domain||'Business')}">${esc(m.name)} / ${esc(m.code)}</option>`).join(''):metrics.map(m=>`<option value="${esc(m.id)}" data-name="${esc(m.name)}" data-domain="${esc(m.business_domain||'Business')}">${esc(m.name)} / ${esc(m.code)}</option>`).join('');
  return `<div class="semantic-create-card"><div class="section-title"><div><h2>补充业务术语</h2><p>把指标缺口直接转为 published term；后端仍由 dataset:manage 权限控制。</p></div>${tag('governed write','amber')}</div><label class="field-label" for="termMetric">绑定指标</label><select id="termMetric" onchange="syncSemanticTermDraft()">${options}</select><label class="field-label" for="termName">术语</label><input id="termName" placeholder="例如：本月收入"/><label class="field-label" for="termDefinition">定义</label><textarea id="termDefinition">说明该指标的业务含义、计算边界和使用注意事项。</textarea><label class="field-label" for="termSynonyms">同义词</label><input id="termSynonyms" placeholder="收入, 营收, GMV"/><button onclick="createSemanticTerm(this)">发布术语</button><div id="semanticCreateResult"></div></div>`;
}
function semanticDomains(terms=[],templates=[]){
  return [...new Set([
    ...datasets.map(d=>d.business_domain),
    ...metrics.map(m=>m.business_domain),
    ...terms.map(t=>t.business_domain),
    ...templates.map(t=>t.business_domain)
  ].filter(Boolean))].sort();
}
function semanticFilterUrl(base,{includeQuery=true}={}){
  const params=new URLSearchParams();
  if(includeQuery && semanticFilterState.q) params.set('q',semanticFilterState.q);
  if(semanticFilterState.domain) params.set('business_domain',semanticFilterState.domain);
  const qs=params.toString();
  return qs?`${base}?${qs}`:base;
}
function semanticFilterBar(terms=[],templates=[]){
  const domains=semanticDomains(terms,templates);
  return `<div class="semantic-filters">
    <div><label class="field-label" for="semanticSearch">搜索术语</label><input id="semanticSearch" value="${esc(semanticFilterState.q)}" placeholder="收入、ROI、风险、渠道" onkeydown="if(event.key==='Enter')applySemanticFilters()"/></div>
    <div><label class="field-label" for="semanticDomainFilter">业务域</label><select id="semanticDomainFilter"><option value="">全部业务域</option>${domains.map(d=>`<option value="${esc(d)}" ${d===semanticFilterState.domain?'selected':''}>${esc(d)}</option>`).join('')}</select></div>
    <div class="semantic-filter-actions"><button onclick="applySemanticFilters(this)">筛选</button><button class="ghost" onclick="clearSemanticFilters(this)">重置</button></div>
  </div>`;
}
async function applySemanticFilters(btn){
  semanticFilterState={
    q:(document.getElementById('semanticSearch')?.value||'').trim(),
    domain:document.getElementById('semanticDomainFilter')?.value||''
  };
  setBusy(btn,true);
  try{ await renderSemantic(); }finally{ setBusy(btn,false); }
}
async function clearSemanticFilters(btn){
  semanticFilterState={q:'',domain:''};
  setBusy(btn,true);
  try{ await renderSemantic(); }finally{ setBusy(btn,false); }
}
function syncSemanticTermDraft(){
  const select=document.getElementById('termMetric');
  const opt=select?.selectedOptions?.[0];
  if(!opt) return;
  const name=opt.dataset.name||opt.textContent.split('/')[0].trim();
  const term=document.getElementById('termName');
  if(term&&!term.value) term.value=name;
}
async function createSemanticTerm(btn){
  const select=document.getElementById('termMetric');
  const opt=select?.selectedOptions?.[0];
  if(!select?.value) return toast('请选择绑定指标');
  setBusy(btn,true);
  const box=document.getElementById('semanticCreateResult');
  if(box) box.innerHTML=inlineLoading('正在发布业务术语');
  try{
    const payload={
      term:termName.value||opt.dataset.name||select.value,
      term_type:'metric',
      business_domain:opt.dataset.domain||'Business',
      definition:termDefinition.value,
      canonical_object_type:'metric',
      canonical_object_id:select.value,
      synonyms:(termSynonyms.value||'').split(',').map(x=>x.trim()).filter(Boolean)
    };
    await api('/api/semantic/terms',{method:'POST',body:JSON.stringify(payload)});
    toast('业务术语已发布');
    await renderSemantic();
  }catch(e){
    if(box) box.innerHTML=stateBanner('error','术语发布失败',e.message);
    toast('术语发布失败：'+e.message);
  }finally{setBusy(btn,false)}
}
async function renderSemantic(){
  const [terms,templates,cov]=await Promise.all([
    api(semanticFilterUrl('/api/semantic/terms')).catch(()=>[]),
    api(semanticFilterUrl('/api/semantic/query-templates',{includeQuery:false})).catch(()=>[]),
    api('/api/semantic/coverage').catch(()=>({}))
  ]);
  const covPct=percent(cov.metric_term_coverage);
  const missing=(cov.missing_metric_terms||[]).length;
  const filtered=semanticFilterState.q||semanticFilterState.domain;
  document.getElementById('page-semantic').innerHTML=`${pageHeader('语义中心','治理指标、字段、术语和查询模板，让业务口径可复用、可解释、可审计。',['Metric glossary','Query templates','Coverage'])}
  <div class="semantic-hero"><div><h2>指标覆盖率 ${covPct}%</h2><p>将技术字段、业务术语和指标口径绑定，减少问数歧义，并把可复用查询模板直接回流到智能问数。</p><div class="coverage-bar"><span style="width:${covPct}%"></span></div><div class="semantic-health">${missing?tag(`${missing} metrics missing`,'amber'):tag('metric terms complete','green')}${tag(`${cov.field_desc_missing_count??0} field gaps`,cov.field_desc_missing_count?'amber':'green')}</div></div><div class="metric-grid tight">${metricCard('数据集',cov.dataset_count??'-','已纳入语义覆盖')}${metricCard('指标',cov.metric_count??'-','可解释业务口径')}${metricCard('字段',cov.field_count??'-','字段说明与分类')}${metricCard('术语',cov.term_count??terms.length,'业务语言资产')}${metricCard('模板',templates.length,'可复用查询入口')}${metricCard('覆盖缺口',missing,'待补指标术语')}</div></div>
  <div class="semantic-layout section-gap">
    <section class="semantic-main">
      ${semanticFilterBar(terms,templates)}
      ${filtered?stateBanner('info','已应用筛选','术语按搜索词过滤，术语和模板按业务域过滤；覆盖率仍展示全局权限范围。',[semanticFilterState.q||'no keyword',semanticFilterState.domain||'all domains']):''}
      <div class="section-title"><div><h2>业务术语资产</h2><p>展示定义、同义词和 canonical object 绑定，给业务用户和数据治理人员同一套口径。</p></div>${tag(`${terms.length} terms`)}</div>
      <div class="semantic-grid">${terms.length?terms.map(semanticTermCard).join(''):emptyState('暂无术语','当前没有可展示的业务术语。')}</div>
      <div class="section-title section-gap"><div><h2>查询模板库</h2><p>把常用问题、图表意图和 SQL 模板绑定，让智能问数有稳定入口。</p></div>${tag(`${templates.length} templates`)}</div>
      <div class="template-grid">${templates.length?templates.map(queryTemplateCard).join(''):emptyState('暂无模板','当前没有可复用的查询模板。')}</div>
    </section>
    <aside class="semantic-side">
      ${semanticTermForm(cov)}
      ${coverageDebt(cov)}
      ${semanticDomainSummary(terms,templates)}
      ${workflowRail([['术语沉淀','定义业务词、同义词和绑定对象'],['模板复用','把高频问题转为 SQL 模板'],['问数治理','通过 Trace 和审计验证语义命中']])}
    </aside>
  </div>
  <div class="grid2 section-gap">
    <section class="semantic-section"><div class="section-title"><div><h2>术语明细</h2><p>后端字段原样对齐 semantic_terms。</p></div></div>${renderTable(terms,{columns:['term','term_type','business_domain','definition','canonical_object_type','canonical_object_id','synonyms','status'],limit:80})}</section>
    <section class="semantic-section"><div class="section-title"><div><h2>模板明细</h2><p>后端字段原样对齐 query_templates。</p></div></div>${renderTable(templates,{columns:['name','business_domain','intent','dataset_id','chart_type','template_text','example_questions','status'],limit:80})}</section>
  </div>`;
  syncSemanticTermDraft();
}

function codexSummary(tasks){
  return {
    total:tasks.length,
    waiting:tasks.filter(t=>t.status==='awaiting_approval').length,
    ready:tasks.filter(t=>t.status==='ready').length,
    dispatched:tasks.filter(t=>['dispatched','completed','failed'].includes(t.status)).length
  };
}
function codexRuntimeHtml(diag,workspaces){
  const cli=diag.cli||{}, sdk=diag.sdk||{}, http=diag.http||{};
  return `<div class="codex-runtime-grid">
    <div class="diagnostic-card"><span>CLI</span><b>${cli.enabled?'已启用':'未启用'}</b><p>${esc(cli.path||'未检测到 CLI')}</p>${cli.version?tag(cli.version,'green'):tag('missing','amber')}</div>
    <div class="diagnostic-card"><span>SDK</span><b>${sdk.module_found?'已检测':'未检测'}</b><p>${esc(sdk.python_module||'Python module')}</p>${statusTag(sdk.module_found?'success':'pending')}</div>
    <div class="diagnostic-card"><span>HTTP</span><b>${http.endpoint_configured?'已配置':'未配置'}</b><p>默认模式：${esc(diag.mode_default||'-')}</p>${statusTag(diag.mode_default||'mock')}</div>
    <div class="diagnostic-card"><span>Workspaces</span><b>${esc(workspaces.length)}</b><p>${esc(workspaces[0]?.repo_path||'等待配置 workspace')}</p>${tag('allowed paths')}</div>
  </div>`;
}
function codexStatusFlow(status){
  const flow=['created','awaiting_approval','ready','dispatched'];
  const labels={created:'创建',awaiting_approval:'待审批',ready:'可派发',dispatched:'已派发'};
  const idx=status==='failed'||status==='completed'?flow.length-1:Math.max(0,flow.indexOf(status));
  return `<div class="mini-flow codex-flow">${flow.map((s,i)=>`<span class="${i<=idx?'done':''}">${esc(labels[s])}</span>`).join('')}</div>`;
}
function codexTaskCard(t){
  const criteria=Array.isArray(t.acceptance_criteria)?t.acceptance_criteria:[];
  return `<button class="codex-task-card ${statusClass(t.status)}" onclick="selectCodexTask('${jsArg(t.id)}',this)">
    <div class="codex-task-head"><span>${esc(t.mode||'mock')}</span>${statusTag(t.status||'draft')}</div>
    <b>${esc(t.title||t.id)}</b>
    <p>${esc(short(criteria[0]||t.result_summary||t.task_prompt||'等待任务说明',86))}</p>
    <div class="codex-task-meta"><span>${esc(timeText(t.updated_at||t.created_at))}</span><span>${esc(t.risk_level||'medium')}</span></div>
  </button>`;
}
function codexTaskQueueHtml(tasks){
  const s=codexSummary(tasks);
  const latest=tasks[0];
  return `<div class="codex-queue-head"><div><h3>任务队列</h3><p>按更新时间排列，点击任务可查看 handoff、事件、产物和源 Trace。</p></div>${tag(`${tasks.length} tasks`)}</div>
  <div class="codex-queue-metrics">${metricCard('待审批',s.waiting,'需要人工确认')}${metricCard('可派发',s.ready,'允许 dispatch')}${metricCard('已派发',s.dispatched,'含 completed / failed')}</div>
  <div class="codex-task-list">${tasks.length?tasks.slice(0,18).map(codexTaskCard).join(''):emptyState('暂无 Codex 任务','从问数或本页创建任务后会出现在这里。')}</div>
  ${latest?`<div class="muted section-gap">最近任务：${esc(latest.id)}</div>`:''}`;
}
function selectCodexTask(id,btn){
  const input=document.getElementById('codexTaskId');
  if(input) input.value=id;
  document.querySelectorAll('.codex-task-card').forEach(x=>x.classList.toggle('active',x===btn));
  loadCodexTask(null);
}
function codexEventContent(event){
  const raw=event?.content;
  const parsed=typeof raw==='string'?parseJsonMaybe(raw):raw;
  if(parsed&&typeof parsed==='object') return JSON.stringify(parsed,null,2);
  return String(raw||'');
}
function codexEventTimeline(events=[]){
  return `<div class="codex-event-timeline">${events.length?events.map((e,i)=>`<div class="codex-event">
    <span>${i+1}</span><div><b>${esc(displayValue(e.event_type||'event'))}</b><p>${esc(e.mode||'-')} · ${esc(timeText(e.created_at))}</p>${codexEventContent(e)?`<details><summary>事件内容</summary><pre class="code">${esc(codexEventContent(e))}</pre></details>`:''}</div>
  </div>`).join(''):emptyState('暂无事件','创建、审批、派发或写入 handoff 后会生成事件。')}</div>`;
}
function codexArtifactCards(artifacts=[]){
  return `<div class="codex-artifact-grid">${artifacts.length?artifacts.map(a=>`<article class="codex-artifact"><div>${tag(a.artifact_type||'artifact')}<span>${esc(timeText(a.created_at))}</span></div><b>${esc(a.path||a.id)}</b>${a.content?`<details><summary>内容预览</summary><pre class="code">${esc(short(a.content,2600))}</pre></details>`:''}</article>`).join(''):emptyState('暂无产物','handoff、CLI 输出或 SDK 输出会在这里归档。')}</div>`;
}
function codexTaskDetailHtml(task,handoff=''){
  const criteria=Array.isArray(task.acceptance_criteria)?task.acceptance_criteria:[];
  return `<div class="codex-detail-shell">
    <section class="codex-detail-main">
      ${stateBanner(task.status==='failed'?'error':task.status==='awaiting_approval'?'pending':'success','任务已加载',task.result_summary||'查看审批、派发、事件和产物。',[task.id,displayValue(task.status),task.mode||'mock'])}
      <div class="codex-detail-title"><div><span>${esc(task.workspace?.name||task.workspace_id||'Workspace')}</span><h3>${esc(task.title||task.id)}</h3></div>${statusTag(task.risk_level||'medium')}</div>
      ${codexStatusFlow(task.status)}
      <div class="codex-criteria">${criteria.length?criteria.map(x=>tag(x)).join(''):tag('默认验收标准','amber')}</div>
      ${task.trace_id?traceActions(task.trace_id,'openCodexTrace'):''}
      <div class="grid2 section-gap">
        <div><h4>Handoff</h4><pre class="code">${esc(handoff||task.task_prompt||'')}</pre></div>
        <div><h4>派发结果</h4><pre class="code">${esc(JSON.stringify(task.result_json||{},null,2))}</pre></div>
      </div>
      <h4>事件链路</h4>${codexEventTimeline(task.events||[])}
      <h4>产物</h4>${codexArtifactCards(task.artifacts||[])}
    </section>
    ${traceDrawer('codexTraceBox','Codex 源 Trace','如果任务来自问数或 Agent 嵌套派发，这里显示源问题、审批和派发步骤。')}
  </div>`;
}
async function refreshCodexTaskQueue(){
  const box=document.getElementById('codexTaskQueue');
  if(!box) return;
  const tasks=await api('/api/codex/tasks').catch(()=>[]);
  box.innerHTML=codexTaskQueueHtml(tasks);
}

async function renderCodex(){
  const [diag,tasks,workspaces]=await Promise.all([api('/api/codex/diagnostics').catch(()=>({})),api('/api/codex/tasks').catch(()=>[]),api('/api/codex/workspaces').catch(()=>[])]);
  document.getElementById('page-codex').innerHTML=`${pageHeader('Codex 运行台','创建、审批、派发和审计工程智能体任务；高风险任务必须保留人工审批。',['Human approval','CLI / SDK','Audit events'])}
  <div class="codex-console section-gap">
    <section class="codex-main">
      ${codexRuntimeHtml(diag,workspaces)}
      <div class="approval-banner"><b>审批边界</b><span>任何会改代码的 Codex 任务都需要人工审批后再派发，页面只展示任务、事件、Trace 和产物，不绕过后端 approval flow。</span></div>
      <div class="card form-shell codex-create-card"><div class="section-title"><div><h2>创建工程任务</h2><p>像 ChatGPT 的 composer 一样输入目标，但把 workspace、验收标准、审批和派发模式结构化。</p></div>${tag('handoff first','amber')}</div><label class="field-label" for="codexWs">Workspace</label><select id="codexWs">${workspaces.map(w=>`<option value="${esc(w.id)}">${esc(w.name)}</option>`).join('')}</select><label class="field-label" for="codexTitle">标题</label><input id="codexTitle" value="完善独立数据智能体平台前端体验"/><label class="field-label" for="codexPrompt">任务</label><textarea id="codexPrompt">进一步优化前端交互、完善数据能力面板、保持 Trace、权限和 SQL Guard 不退化，并补充轻量静态验证。</textarea><div class="form-row"><div><label class="field-label" for="codexMode">模式</label><select id="codexMode"><option value="mock">mock</option><option value="http">http</option><option value="cli">cli</option><option value="sdk">sdk</option></select></div><button onclick="createCodexTask(this)">创建任务</button></div><div id="codexResult"></div></div>
    </section>
    <aside class="codex-side">
      <div class="card"><div id="codexTaskQueue">${codexTaskQueueHtml(tasks)}</div></div>
      <div class="card codex-dispatch-card"><h3>审批与派发</h3><div class="form-row"><input id="codexTaskId" placeholder="任务ID"/><select id="dispatchMode"><option value="mock">mock</option><option value="http">http</option><option value="cli">cli</option><option value="sdk">sdk</option></select></div><div class="toolbar"><button onclick="approveCodexTask(this)">审批</button><button class="secondary" onclick="dispatchCodexTask(this)">派发</button><button class="ghost" onclick="loadCodexTask(this)">查看任务</button></div></div>
    </aside>
  </div>
  <div id="codexTaskDetail" class="section-gap">${emptyState('未选择任务','点击任务队列或输入任务 ID 后，会显示 handoff、事件、产物和源 Trace。')}</div>`;
}
async function createCodexTask(btn){setBusy(btn,true);document.getElementById('codexResult').innerHTML=inlineLoading('正在创建工程任务');try{const r=await api('/api/codex/tasks',{method:'POST',body:JSON.stringify({workspace_id:codexWs.value,title:codexTitle.value,task_prompt:codexPrompt.value,mode:codexMode.value,risk_level:'high',requires_approval:true,acceptance_criteria:['保持平台现有接口兼容','不回退 Trace、RBAC、SQL Guard 和审计能力','运行 python3 scripts/static_check.py']})});document.getElementById('codexResult').innerHTML=stateBanner('pending','Codex 任务已创建','高风险工程任务仍需人工审批后再派发。',[r.id,r.status]);const taskInput=document.getElementById('codexTaskId'); if(taskInput) taskInput.value=r.id||''; document.getElementById('codexTaskDetail').innerHTML=codexTaskDetailHtml(r,r.task_prompt); await refreshCodexTaskQueue(); toast('Codex 任务已创建');}catch(e){document.getElementById('codexResult').innerHTML=stateBanner('error','Codex 任务创建失败',e.message);toast(e.message)}finally{setBusy(btn,false)}}
async function approveCodexTask(btn){const id=codexTaskId.value.trim(); if(!id)return toast('请输入任务ID'); setBusy(btn,true);document.getElementById('codexTaskDetail').innerHTML=inlineLoading('正在审批任务');try{const r=await api(`/api/codex/tasks/${id}/approve`,{method:'POST',body:JSON.stringify({comment:'页面审批'})});toast('已审批');document.getElementById('codexTaskDetail').innerHTML=codexTaskDetailHtml(r,r.task_prompt); await refreshCodexTaskQueue(); if(r.trace_id) openCodexTrace(r.trace_id,'steps',null).catch(()=>{});}catch(e){document.getElementById('codexTaskDetail').innerHTML=stateBanner('error','审批失败',e.message)}finally{setBusy(btn,false)}}
async function dispatchCodexTask(btn){const id=codexTaskId.value.trim(); if(!id)return toast('请输入任务ID'); setBusy(btn,true);document.getElementById('codexTaskDetail').innerHTML=inlineLoading('正在派发任务');try{const r=await api(`/api/codex/tasks/${id}/dispatch`,{method:'POST',body:JSON.stringify({mode:dispatchMode.value})});document.getElementById('codexTaskDetail').innerHTML=codexTaskDetailHtml(r,r.task_prompt); await refreshCodexTaskQueue(); if(r.trace_id) openCodexTrace(r.trace_id,'steps',null).catch(()=>{});}catch(e){document.getElementById('codexTaskDetail').innerHTML=stateBanner('error','派发失败',e.message)}finally{setBusy(btn,false)}}
async function loadCodexTask(btn){const id=codexTaskId.value.trim(); if(!id)return toast('请输入任务ID'); setBusy(btn,true);document.getElementById('codexTaskDetail').innerHTML=inlineLoading('正在读取任务详情');try{const r=await api('/api/codex/tasks/'+id); const h=await api(`/api/codex/tasks/${id}/handoff`).catch(()=>({handoff:''})); document.getElementById('codexTaskDetail').innerHTML=codexTaskDetailHtml(r,h.handoff||r.task_prompt||''); if(r.trace_id) openCodexTrace(r.trace_id,'summary',null).catch(()=>{});}catch(e){document.getElementById('codexTaskDetail').innerHTML=stateBanner('error','任务加载失败',e.message)}finally{setBusy(btn,false)}}

async function renderReports(){
  const reports=await api('/api/reports').catch(()=>[]);
  reportsCache=reports;
  const statusCounts=countBy(reports,'status');
  const latest=reports[0];
  document.getElementById('page-reports').innerHTML=`${pageHeader('报告中心','管理 AI 生成报告的草稿、复核、批准和发布状态。',['Draft','Review','Publish'])}
  <div class="metric-grid tight">${metricCard('报告资产',reports.length,'AI 生成和人工复核的报告')}${metricCard('待复核',statusCounts.pending_review||0,'需要人工确认')}${metricCard('已批准',statusCounts.approved||0,'可进入发布')}${metricCard('最近更新',latest?timeText(latest.updated_at||latest.created_at):'-','报告链路最新动作')}</div>
  <div class="report-workspace section-gap">
    <section class="report-stream"><div class="section-title"><div><h2>报告资产库</h2><p>像对话历史一样检索报告资产，按状态和来源类型快速收窄，再进入 Canvas 复核证据。</p></div>${tag(`${reports.length} reports`)}</div>${reportFilterBar(reports)}<div id="reportAssetGrid" class="report-grid"></div><div class="card section-gap"><div class="card-heading"><h3>报告明细</h3>${tag('audit fields')}</div><div id="reportTablePanel"></div></div></section>
    <aside class="report-side">
      <div id="reportDetail">${latest?`<button class="secondary" onclick="openReportDetail('${jsArg(latest.id)}',this)">打开最近报告</button>`:emptyState('未选择报告','选择报告后会显示正文、版本和证据。')}</div>
      ${traceDrawer('reportTraceBox','报告证据','从报告 evidence_json 中打开 Trace，复核 SQL、权限和执行步骤。')}
      <div class="workflow-card section-gap"><h3>报告状态流</h3>${workflowRail([['草稿生成','Agent 输出报告草稿并关联证据。'],['提交复核','业务 owner 或分析师发起 review。'],['管理员批准','人工确认口径、证据和风险。'],['发布分发','进入业务侧阅读和归档。']])}</div>
    </aside>
  </div>
  `;
  renderReportList();
}
async function openReportDetail(id, btn){
  const box=document.getElementById('reportDetail');
  if(!box) return;
  activeReportId=id;
  renderReportList();
  setBusy(btn,true);
  box.innerHTML=inlineLoading('正在读取报告版本和证据');
  try{
    const report=await api('/api/reports/'+id);
    box.innerHTML=reportDetailHtml(report);
    const traceId=[...collectTraceIds(reportEvidence(report))][0];
    if(traceId) openReportTrace(traceId,'summary',null).catch(()=>{});
    box.scrollIntoView({behavior:'smooth',block:'start'});
  }catch(e){
    box.innerHTML=stateBanner('error','报告加载失败',e.message);
  }finally{
    setBusy(btn,false);
  }
}
async function runReportAction(id, action, btn){
  const endpoint={approve:'approve',publish:'publish','submit-review':'submit-review'}[action];
  if(!endpoint) return;
  setBusy(btn,true);
  try{
    await api(`/api/reports/${id}/${endpoint}`,{method:'POST'});
    toast({approve:'报告已批准',publish:'报告已发布','submit-review':'已提交复核'}[action]||'报告状态已更新');
    await renderReports();
    await openReportDetail(id,null);
  }catch(e){
    toast('报告操作失败：'+e.message);
  }finally{
    setBusy(btn,false);
  }
}
function knowledgeBindingAgents(kb){
  if(!kb?.adapter_id) return [];
  return agents.filter(a=>a.adapter_id===kb.adapter_id);
}
function knowledgeDetailHtml(kb,versions=[]){
  if(!kb) return emptyState('未选择知识库','点击左侧知识资产查看版本、Adapter 和 Agent 引用情况。');
  const bound=knowledgeBindingAgents(kb);
  const kbName=kb.name||kb.id;
  const preferredAgent=bound[0]?.id||'agent_router';
  const actions=contextActionStrip([
    {label:'用知识库提问',onclick:`setChatDraft('${jsArg(`基于知识库“${kbName}”回答：请说明它适合支撑哪些业务问题，并给出可追问方向。`)}','${jsArg(preferredAgent)}')`},
    {label:'查看语义资产',onclick:`openSemanticFiltered('${jsArg(kbName)}','')`},
    {label:'加入工作包',onclick:`addKnowledgeToContextPack('${jsArg(kb.id)}',this)`},
    {label:'查看审计',onclick:`openAuditFiltered('${jsArg(kb.id)}')`},
    {label:'创建接入任务',onclick:`setCodexDraft('${jsArg(`完善知识库接入：${kbName}`)}','${jsArg(`检查知识库 ${kb.id} 的 Adapter 绑定、版本展示、Agent 引用和审计链路，保持权限、Trace 和外部知识源边界不退化。`)}')`}
  ]);
  return `<div class="knowledge-detail">
    <div class="card-heading"><div><h3>${esc(kb.name||kb.id)}</h3><p class="muted">${esc(kb.backend_type||'mock')} · ${esc(kb.type||'document')} · ${esc(kb.owner_id||'-')}</p></div>${statusTag(kb.status||'active')}</div>
    <p>${esc(kb.description||'暂无说明')}</p>
    <div class="knowledge-meta">${tag(kb.id)}${kb.adapter_id?tag(kb.adapter_id,'green'):tag('no adapter','amber')}${tag(`${versions.length} versions`)}</div>
    ${actions}
    <h4>版本</h4>${renderTable(versions,{columns:['version','status','checksum','created_at','id'],compact:true,limit:20})}
    <h4>Agent 引用</h4>${bound.length?renderTable(bound,{columns:['name','type','status','risk_level','adapter_id'],compact:true,limit:20}):stateBanner('warn','未发现直接绑定 Agent','当前只能按 adapter_id 推断引用关系；没有匹配的 Agent。')}
  </div>`;
}
function selectKnowledgeBase(id){
  activeKnowledgeBaseId=id;
  document.querySelectorAll('.knowledge-card').forEach(card=>card.classList.toggle('active',card.dataset.kbId===id));
  const kb=knowledgeBasesCache.find(x=>x.id===id);
  const box=document.getElementById('knowledgeDetail');
  if(!box) return;
  box.innerHTML=knowledgeDetailHtml(kb,knowledgeVersionCache[id]||[]);
}
async function createKnowledgeBase(btn){
  setBusy(btn,true);
  const box=document.getElementById('knowledgeCreateResult');
  if(box) box.innerHTML=inlineLoading('正在注册知识库');
  try{
    const payload={name:kbName.value,type:kbType.value,backend_type:kbBackend.value,adapter_id:kbAdapter.value||null,description:kbDescription.value};
    const created=await api('/api/knowledge-bases',{method:'POST',body:JSON.stringify(payload)});
    toast('知识库已注册');
    await renderKnowledge();
    setTimeout(()=>selectKnowledgeBase(created.id),40);
  }catch(e){
    if(box) box.innerHTML=stateBanner('error','注册失败',e.message);
    toast('知识库注册失败：'+e.message);
  }finally{setBusy(btn,false)}
}
async function renderKnowledge(){
  const kbs=await api('/api/knowledge-bases').catch(()=>[]);
  const versionLists=await Promise.all(kbs.map(k=>api(`/api/knowledge-bases/${k.id}/versions`).catch(()=>[])));
  knowledgeBasesCache=kbs;
  knowledgeVersionCache=Object.fromEntries(kbs.map((k,i)=>[k.id,versionLists[i]||[]]));
  activeKnowledgeBaseId=activeKnowledgeBaseId||kbs[0]?.id||'';
  const filtered=kbs.filter(knowledgeMatches);
  const backendCounts=countBy(kbs,'backend_type');
  const adapterOptions=[...new Set([...kbs.map(k=>k.adapter_id).filter(Boolean),...agents.map(a=>a.adapter_id).filter(Boolean)])].map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join('');
  document.getElementById('page-knowledge').innerHTML=`${pageHeader('知识库','注册知识库、绑定 Agent、管理版本与引用权限，可对接 RAGFlow / Dify Knowledge。',['Knowledge binding','Versioning','Permissions'])}
  <div class="metric-grid tight">${metricCard('知识库',kbs.length,'已注册外部知识源')}${metricCard('后端类型',Object.keys(backendCounts).length,'RAGFlow、Dify 或 mock')}${metricCard('活跃版本',versionLists.flat().filter(v=>v.status==='active').length,'可被 Agent 引用')}${metricCard('Adapter',new Set(kbs.map(k=>k.adapter_id).filter(Boolean)).size,'外部连接点')}</div>
  <div class="knowledge-workspace section-gap">
    <section class="ops-main"><div class="section-title"><div><h2>知识资产库</h2><p>关注知识源、后端、版本和绑定入口，不在平台内复制真实知识内容。</p></div>${tag(`${kbs.length} bases`)}</div>${knowledgeFilterBar(filtered)}<div id="knowledgeAssetGrid" class="knowledge-grid"></div><div class="card section-gap"><div class="card-heading"><h3>知识库明细</h3>${tag('registry')}</div><div id="knowledgeTablePanel"></div></div></section>
    <aside class="knowledge-side">
      <div class="card form-shell"><h3>注册知识库</h3><p class="muted">只登记外部知识源和 Adapter，不在前端保存真实知识内容。</p><label class="field-label" for="kbName">名称</label><input id="kbName" value="经营政策知识库"/><div class="form-row"><div><label class="field-label" for="kbType">类型</label><select id="kbType"><option value="document">document</option><option value="faq">faq</option><option value="table">table</option></select></div><div><label class="field-label" for="kbBackend">后端</label><select id="kbBackend"><option value="mock">mock</option><option value="ragflow">ragflow</option><option value="dify">dify</option></select></div></div><label class="field-label" for="kbAdapter">Adapter</label><input id="kbAdapter" list="kbAdapterOptions" placeholder="ad_knowledge"/><datalist id="kbAdapterOptions">${adapterOptions}</datalist><label class="field-label" for="kbDescription">说明</label><textarea id="kbDescription">用于问数和报告生成时引用经营政策、产品口径和客服知识。</textarea><button onclick="createKnowledgeBase(this)">注册</button><div id="knowledgeCreateResult"></div></div>
      <div id="knowledgeDetail" class="card section-gap">${knowledgeDetailHtml(kbs[0],versionLists[0]||[])}</div>
      <div class="workflow-card section-gap"><h3>接入策略</h3>${workflowRail([['注册','记录知识库、后端类型和 Adapter。'],['版本','维护可回溯版本与 checksum。'],['绑定','按 Agent 能力域授权引用。'],['审计','保留创建、版本和引用动作。']])}</div>
    </aside>
  </div>`;
  renderKnowledgeList();
  if(activeKnowledgeBaseId) selectKnowledgeBase(activeKnowledgeBaseId);
}
async function renderEvals(){
  const sets=await api('/api/eval-sets').catch(()=>[]);
  const caseLists=await Promise.all(sets.map(s=>api(`/api/eval-sets/${s.id}/cases`).catch(()=>[])));
  evalSetsCache=sets;
  evalCaseCache=Object.fromEntries(sets.map((s,i)=>[s.id,caseLists[i]||[]]));
  const filtered=sets.filter(evalSetMatches);
  activeEvalSetId=activeEvalSetId && filtered.some(s=>s.id===activeEvalSetId) ? activeEvalSetId : filtered[0]?.id || sets[0]?.id || '';
  const totalCases=caseLists.flat().length;
  document.getElementById('page-evals').innerHTML=`${pageHeader('评测中心','用评测集对 Agent 回答质量、路由、SQL Guard 和回归结果做持续检查。',['Eval sets','Regression','Quality gate'])}
  <div class="metric-grid tight">${metricCard('评测集',sets.length,'覆盖业务问数和多 Agent 能力')}${metricCard('用例',totalCases,'问题、期望 SQL 和标签')}${metricCard('可测 Agent',agents.length,'当前权限范围内')}${metricCard('默认门槛','0.80','建议作为回归判定线')}</div>
  <div class="eval-workstation section-gap">
    <section class="ops-main"><div class="section-title"><div><h2>评测资产库</h2><p>像项目上下文一样筛选回归套件、定位用例，并把关键问题直接回放到问数或工程任务。</p></div>${tag(`${totalCases} cases`)}</div>${evalFilterBar(filtered)}<div id="evalSetGrid" class="eval-grid"></div><div id="evalCasePreview" class="section-gap">${evalCasePreviewHtml(activeEvalSetId)}</div></section>
    <aside class="eval-side">
      <div class="card form-shell eval-runner"><h3>运行评测</h3><p class="muted">选择评测集和 Agent，生成结果明细；运行会写入 Trace 与审计。</p><label class="field-label" for="evalSet">评测集</label><select id="evalSet" onchange="selectEvalSet(this.value)">${evalSetOptions(sets,activeEvalSetId)}</select><label class="field-label" for="evalAgent">Agent</label><select id="evalAgent">${agentOptions()}</select><button onclick="runEval(this)">运行评测</button><div id="evalResult"></div></div>
      <div class="card form-shell eval-create-card"><h3>创建评测集</h3><p class="muted">把新的业务场景沉淀为可重复运行的回归套件。</p><label class="field-label" for="evalSetName">名称</label><input id="evalSetName" value="经营分析回归集"/><div class="form-row"><div><label class="field-label" for="evalSetDomain">业务域</label><input id="evalSetDomain" value="Business"/></div><button onclick="createEvalSet(this)">创建</button></div><label class="field-label" for="evalSetDescription">说明</label><textarea id="evalSetDescription">覆盖常见经营问数、SQL Guard、图表和 Trace 证据链。</textarea><div id="evalSetCreateResult"></div></div>
      <div class="card form-shell eval-create-card"><h3>添加用例</h3><p class="muted">一条用例就是一个可回放问题，可带期望 SQL 与标签。</p><label class="field-label" for="evalCaseSet">目标评测集</label><select id="evalCaseSet">${evalSetOptions(sets,activeEvalSetId)}</select><label class="field-label" for="evalCaseQuestion">问题</label><textarea id="evalCaseQuestion">按渠道统计本月收入，并说明最高渠道。</textarea><label class="field-label" for="evalCaseSql">期望 SQL</label><textarea id="evalCaseSql">${esc(sampleSqlForDataset(defaultQueryDataset()))}</textarea><input id="evalCaseTags" value="收入, SQL Guard, Trace" aria-label="标签"/><button onclick="createEvalCase(this)">添加用例</button><div id="evalCaseCreateResult"></div></div>
    </aside>
  </div>`;
  renderEvalDirectory();
}
function evalSetOptions(sets=[],selected=''){
  return sets.length?sets.map(s=>`<option value="${esc(s.id)}" ${s.id===selected?'selected':''}>${esc(s.name)}</option>`).join(''):'<option value="">暂无评测集</option>';
}
function evalCasePreviewHtml(setId){
  const set=evalSetsCache.find(s=>s.id===setId);
  const cases=evalCaseCache[setId]||[];
  if(!setId) return emptyState('未选择评测集','创建或选择评测集后会显示用例清单。');
  return `<div class="eval-case-preview"><div class="card-heading"><div><h3>${esc(set?.name||setId)}</h3><p class="muted">${esc(set?.description||'暂无说明')}</p></div>${tag(`${cases.length} cases`,'green')}</div><div class="eval-case-list">${cases.length?cases.map((c,i)=>evalCaseCard(c,i,setId)).join(''):emptyState('暂无用例','在右侧添加第一条业务问题。')}</div></div>`;
}
function evalCaseCard(c,index,setId){
  const tags=asList(c.tags);
  const expected=c.expected_sql||c.expected_answer||'尚未维护期望 SQL 或答案';
  return `<article class="eval-case-card">
    <div class="eval-case-head"><span>${String(index+1).padStart(2,'0')}</span><div><b>${esc(c.question||c.id)}</b><p>${esc(short(expected,110))}</p></div></div>
    <div class="eval-tags">${compactTags(tags,5)}</div>
    <div class="eval-actions"><button class="report-action" onclick="setEvalCaseChatDraft('${jsArg(c.question||'')}', '${jsArg(setId)}')">回放问数</button><button class="report-action" onclick="setEvalCaseCodexDraft('${jsArg(c.id)}','${jsArg(c.question||'')}', '${jsArg(setId)}')">创建修复任务</button></div>
  </article>`;
}
function renderEvalDirectory(){
  const filtered=evalSetsCache.filter(evalSetMatches);
  const grid=document.getElementById('evalSetGrid');
  if(grid) grid.innerHTML=filtered.length?filtered.map(s=>evalSetCard(s,evalCaseCache[s.id]||[])).join(''):emptyState('没有匹配评测集','调整搜索、业务域或标签筛选。');
  const count=document.getElementById('evalResultCount');
  if(count) count.innerText=`显示 ${filtered.length} / ${evalSetsCache.length}`;
  if(activeEvalSetId && !filtered.some(s=>s.id===activeEvalSetId)){
    activeEvalSetId=filtered[0]?.id||'';
    const preview=document.getElementById('evalCasePreview');
    if(preview) preview.innerHTML=activeEvalSetId?evalCasePreviewHtml(activeEvalSetId):emptyState('没有匹配评测集','调整筛选后会恢复用例预览。');
  }else if(!activeEvalSetId && filtered[0]){
    activeEvalSetId=filtered[0].id;
  }
  if(activeEvalSetId) selectEvalSet(activeEvalSetId);
}
function setEvalFilter(key,value){
  evalFilterState[key]=value;
  renderEvalDirectory();
}
function resetEvalFilters(){
  evalFilterState={q:'',domain:'all',tag:'all'};
  const q=document.getElementById('evalSearch');
  if(q) q.value='';
  const domain=document.getElementById('evalDomainFilter');
  if(domain) domain.value='all';
  const tagFilter=document.getElementById('evalTagFilter');
  if(tagFilter) tagFilter.value='all';
  renderEvalDirectory();
}
function setEvalCaseChatDraft(question,setId=''){
  setChatDraft(`回放评测用例${setId?`（${setId}）`:''}：${question}`,'agent_router');
}
function setEvalCaseCodexDraft(caseId,question,setId=''){
  setCodexDraft(`修复评测用例：${caseId||'eval case'}`,`围绕评测集 ${setId||'-'} 的用例 ${caseId||'-'} 检查问数、路由、SQL Guard、Trace 证据和前端结果展示。问题：${question||'-'}。保持 RBAC、审计和评测记录不退化。`);
}
function selectEvalSet(id){
  activeEvalSetId=id;
  document.querySelectorAll('.eval-card').forEach(card=>card.classList.toggle('active',card.dataset.evalSetId===id));
  const runSelect=document.getElementById('evalSet'); if(runSelect) runSelect.value=id;
  const caseSelect=document.getElementById('evalCaseSet'); if(caseSelect) caseSelect.value=id;
  const preview=document.getElementById('evalCasePreview'); if(preview) preview.innerHTML=evalCasePreviewHtml(id);
}
async function createEvalSet(btn){
  const box=document.getElementById('evalSetCreateResult');
  setBusy(btn,true);
  if(box) box.innerHTML=inlineLoading('正在创建评测集');
  try{
    const payload={name:evalSetName.value,business_domain:evalSetDomain.value,description:evalSetDescription.value};
    const created=await api('/api/eval-sets',{method:'POST',body:JSON.stringify(payload)});
    activeEvalSetId=created.id;
    toast('评测集已创建');
    await renderEvals();
    document.getElementById('evalSetCreateResult').innerHTML=stateBanner('success','评测集已创建','可以继续添加用例并运行回归。',[created.id]);
  }catch(e){
    if(box) box.innerHTML=stateBanner('error','评测集创建失败',e.message);
    toast('评测集创建失败：'+e.message);
  }finally{setBusy(btn,false)}
}
async function createEvalCase(btn){
  const box=document.getElementById('evalCaseCreateResult');
  const setId=document.getElementById('evalCaseSet')?.value||activeEvalSetId;
  if(!setId) return toast('请先选择或创建评测集');
  setBusy(btn,true);
  if(box) box.innerHTML=inlineLoading('正在添加评测用例');
  try{
    const payload={
      question:evalCaseQuestion.value,
      expected_answer:'',
      expected_sql:evalCaseSql.value,
      expected_chart_json:{},
      expected_report_outline:'',
      tags:(evalCaseTags.value||'').split(',').map(x=>x.trim()).filter(Boolean)
    };
    const created=await api(`/api/eval-sets/${setId}/cases`,{method:'POST',body:JSON.stringify(payload)});
    activeEvalSetId=setId;
    toast('评测用例已添加');
    await renderEvals();
    document.getElementById('evalCaseCreateResult').innerHTML=stateBanner('success','评测用例已添加','该问题会参与后续回归运行。',[created.id,setId]);
  }catch(e){
    if(box) box.innerHTML=stateBanner('error','评测用例添加失败',e.message);
    toast('评测用例添加失败：'+e.message);
  }finally{setBusy(btn,false)}
}
async function runEval(btn){
  const resultBox=document.getElementById('evalResult');
  const setId=document.getElementById('evalSet')?.value||activeEvalSetId;
  if(!setId) return toast('请选择评测集');
  setBusy(btn,true);
  resultBox.innerHTML=inlineLoading('正在运行评测集');
  try{
    const run=await api('/api/eval-runs',{method:'POST',body:JSON.stringify({eval_set_id:setId,agent_id:evalAgent.value})});
    activeEvalSetId=setId;
    resultBox.innerHTML=evalRunHtml(run);
  }catch(e){
    resultBox.innerHTML=stateBanner('error','评测运行失败',e.message);
  }finally{setBusy(btn,false)}
}
function configRows(config){
  return Object.entries(config||{}).map(([key,value])=>({
    key,
    value: typeof value==='object' ? JSON.stringify(value) : String(value)
  }));
}
function endpointRows(){
  return [
    {endpoint:'/_ops/healthz',purpose:'Canonical health',access:'X-Ops-Token / ops cookie'},
    {endpoint:'/_ops/system',purpose:'Runtime and disk summary',access:'X-Ops-Token / ops cookie'},
    {endpoint:'/_ops/config',purpose:'Redacted runtime config',access:'X-Ops-Token / ops cookie'},
    {endpoint:'/_ops/persistence',purpose:'SQLite and data directory checks',access:'X-Ops-Token / ops cookie'},
    {endpoint:'/_ops/errors',purpose:'Runtime warnings and failed traces',access:'X-Ops-Token / ops cookie'},
    {endpoint:'/_ops/metrics',purpose:'Prometheus-style metrics',access:'X-Ops-Token / ops cookie'},
    {endpoint:'/_admin/',purpose:'Admin control surface',access:'RBAC admin role'}
  ];
}
function roleCard(role){
  const permissions=(role.permissions||[]).map(p=>tag(p.code||p)).join('');
  return `<article class="role-card"><div class="role-head"><div><span>${esc(role.id)}</span><b>${esc(role.name)}</b></div>${tag(`${(role.permissions||[]).length} permissions`,'green')}</div><p>${esc(role.description||'暂无说明')}</p><div class="role-permissions">${permissions||'<span class="muted">暂无权限</span>'}</div></article>`;
}
async function renderOps(){
  const [live,ready,version,stats,config]=await Promise.all([
    api('/api/health/live').catch(e=>({status:'error',detail:e.message})),
    api('/api/health/ready').catch(e=>({status:'error',detail:e.message,warnings:[e.message]})),
    api('/api/version').catch(e=>({name:'Data Agent',version:'unknown',detail:e.message})),
    api('/api/admin/stats').catch(()=>({counts:{agents:agents.length,datasets:datasets.length,metrics:metrics.length}})),
    api('/api/admin/config').catch(()=>null)
  ]);
  const counts=stats.counts||{};
  const warnings=ready.warnings||config?.runtime_warnings||[];
  document.getElementById('page-ops').innerHTML=`${pageHeader('Ops 控制面','参考 HFS 只读诊断面，把健康检查、持久化、错误和指标入口集中展示；不承载重启、写配置或执行 SQL。',['Read-only','HFS','Diagnostics'])}
  <div class="metric-grid tight">${metricCard('Live',live.status||'unknown',`Version ${version.version||'-'}`,statusClass(live.status))}${metricCard('Ready',ready.status||'unknown',`${warnings.length} runtime warnings`,warnings.length?'amber':statusClass(ready.status))}${metricCard('Trace',counts.traces??0,'执行链路累计')}${metricCard('Audit',counts.audit_logs??0,'审计事件累计')}</div>
  <div class="control-split section-gap">
    <section class="ops-main"><div class="section-title"><div><h2>HFS 只读诊断入口</h2><p>浏览器入口使用 ops cookie；CLI 和自动化优先传 X-Ops-Token。</p></div><div class="control-actions"><button onclick="window.open('/_ops/','_blank','noopener')">打开 /_ops/</button><button class="secondary" onclick="window.open('/_ops/metrics','_blank','noopener')">Metrics</button></div></div>${renderTable(endpointRows(),{columns:['endpoint','purpose','access'],limit:20})}</section>
    <aside class="ops-side"><h3>运行摘要</h3>${stateBanner(warnings.length?'warn':'success',warnings.length?'存在运行告警':'运行配置无告警',warnings.join('；')||'当前 readiness 未返回运行告警。')}<div class="config-mini">${configRows({app_env:config?.app_env||version.env||'-',hf_space:config?.hf_space??'-',data_dir:config?.data_dir||'-',codex_mode:config?.codex_mode||'-'}).map(r=>`<div class="row"><span>${esc(r.key)}</span><b>${esc(r.value)}</b></div>`).join('')}</div></aside>
  </div>
  <div class="grid2 section-gap">
    ${card('Ops 边界', '<p class="muted">/_ops 保持只读：health、system、config、persistence、errors 和 metrics。写操作、审批、用户角色和审计查看归入 Admin 控制面。</p><div>'+tag('no write actions','green')+tag('no raw secrets','green')+tag('SQL Guard intact','green')+'</div>')}
    ${card('Admin 入口', '<p class="muted">/_admin/ 复用平台登录与 RBAC，仅 admin 角色可读取管理 API。当前交付先做只读管理驾驶舱，避免引入新的外部 token 或后台写动作。</p><button class="secondary" onclick="showPage(&quot;admin&quot;)">进入 Admin 控制面</button>')}
  </div>`;
}
async function renderAdmin(){
  try{
    const [stats,users,roles,config,logs]=await Promise.all([
      api('/api/admin/stats'),
      api('/api/admin/users'),
      api('/api/admin/roles'),
      api('/api/admin/config'),
      api('/api/admin/audit-logs?limit=120')
    ]);
    const counts=stats.counts||{};
    const activeUsers=users.filter(u=>u.status==='active').length;
    const lockedUsers=users.filter(u=>u.locked_until).length;
    document.getElementById('page-admin').innerHTML=`${pageHeader('Admin 控制面','面向平台管理员的只读管理驾驶舱，聚合用户、角色、运行配置、关键统计和最近审计事件。',['RBAC admin','Audit','Config'])}
    <div class="metric-grid tight">${metricCard('用户',users.length,`${activeUsers} active`)}${metricCard('角色',roles.length,'权限集合')}${metricCard('锁定账号',lockedUsers,'登录保护状态',lockedUsers?'amber':'')}${metricCard('失败 Trace',stats.recent_failures?.length||0,'最近失败执行',stats.recent_failures?.length?'amber':'')}</div>
    <div class="control-split section-gap">
      <section class="ops-main"><div class="section-title"><div><h2>用户与账号状态</h2><p>账号读取仍由 /api/admin/users 和 require_admin 保护。</p></div>${tag(`${users.length} users`)}</div>${renderTable(users,{columns:['username','name','email','department','status','failed_login_count','locked_until','last_login_at'],limit:120})}</section>
      <aside class="ops-side"><h3>角色与权限</h3><div class="role-grid">${roles.map(roleCard).join('')}</div></aside>
    </div>
    <div class="control-split section-gap">
      <section class="ops-main"><div class="section-title"><div><h2>平台统计</h2><p>用于判断平台资产、Trace、评测和报告的运营规模。</p></div>${tag('admin stats','green')}</div><div class="metric-grid tight">${Object.entries(counts).map(([k,v])=>metricCard(displayKey(k),v,'row count')).join('')}</div><div class="section-gap"><h3>近期失败 Trace</h3>${renderTable(stats.recent_failures||[],{columns:['id','agent_id','status','duration_ms','created_at'],limit:20})}</div></section>
      <aside class="ops-side"><h3>运行配置摘要</h3>${renderTable(configRows(config),{columns:['key','value'],limit:80,compact:true})}</aside>
    </div>
    <div class="card section-gap"><div class="card-heading"><h3>最近审计事件</h3>${tag(`${logs.length} logs`)}</div>${renderTable(logs,{columns:['created_at','user_id','action','object_type','object_id','request_id','ip'],limit:120})}</div>`;
  }catch(e){
    document.getElementById('page-admin').innerHTML=`${pageHeader('Admin 控制面','该入口需要 admin 角色。',['RBAC admin'])}${stateBanner('error','无法读取 Admin 控制面',e.message)}<div class="card section-gap"><h3>权限边界</h3><p class="muted">管理 API 继续由 /api/admin/* 和 require_admin 保护，普通用户不能读取用户、角色、配置或管理统计。</p></div>`;
  }
}
function auditTraceId(log){
  const detail=log?.detail_json||{};
  if(typeof detail.trace_id==='string') return detail.trace_id;
  if(log?.object_type==='trace' && String(log.object_id||'').startsWith('trace_')) return log.object_id;
  return '';
}
function auditLogMatches(log,query,action,objectType){
  const haystack=JSON.stringify(log||{}).toLowerCase();
  return (!query || haystack.includes(query.toLowerCase())) && (!action || log.action===action) && (!objectType || log.object_type===objectType);
}
function auditFilters(logs){
  const actions=[...new Set(logs.map(l=>l.action).filter(Boolean))].sort();
  const objects=[...new Set(logs.map(l=>l.object_type).filter(Boolean))].sort();
  return `<div class="audit-filters"><input id="auditSearch" placeholder="搜索 action / object / request / trace" oninput="refreshAuditView()" aria-label="搜索审计日志"/><select id="auditActionFilter" onchange="refreshAuditView()"><option value="">全部动作</option>${actions.map(a=>`<option value="${esc(a)}">${esc(displayValue(a))}</option>`).join('')}</select><select id="auditObjectFilter" onchange="refreshAuditView()"><option value="">全部对象</option>${objects.map(o=>`<option value="${esc(o)}">${esc(displayValue(o))}</option>`).join('')}</select></div>`;
}
function auditDetailHtml(log){
  if(!log) return emptyState('未选择事件','点击最近事件可查看 detail_json、request_id 和 Trace pivot。');
  const traceId=auditTraceId(log);
  const objectLabel=`${log.object_type||'object'} ${log.object_id||''}`.trim();
  const auditActions=contextActionStrip([
    {label:'分析该事件',onclick:`setAnalysisDraft('${jsArg(`分析审计事件 ${log.id||''}：动作 ${log.action||'-'}，对象 ${objectLabel || '-'}，请判断风险、影响范围和后续处置。`)}','agent_business_analysis')`},
    {label:'继续追问',onclick:`setChatDraft('${jsArg(`解释审计事件 ${log.id||''}：${log.action||'-'} / ${objectLabel || '-'}，并说明关联 Trace 和权限含义。`)}','agent_router')`},
    {label:'打开相关对象',onclick:`openRelatedResource('${jsArg(log.object_type||'')}','${jsArg(log.object_id||'')}')`},
    {label:'创建加固任务',onclick:`setCodexDraft('${jsArg(`审计事件加固：${log.action||'audit'}`)}','${jsArg(`围绕审计事件 ${log.id||''}（${log.action||'-'} / ${objectLabel || '-'}）检查相关前后端链路、Trace 展示、权限边界和审计记录，不要弱化 RBAC、SQL Guard 或审批流程。`)}')`}
  ]);
  return `<div class="audit-detail">
    <div class="card-heading"><div><h3>${esc(displayValue(log.action))}</h3><p class="muted">${esc(log.user_id||'anonymous')} · ${esc(timeText(log.created_at))}</p></div>${tag(log.id||'audit')}</div>
    <div class="config-mini"><div class="row"><span>Object</span><b>${esc(log.object_type||'-')} / ${esc(log.object_id||'-')}</b></div><div class="row"><span>Request</span><b>${esc(log.request_id||'-')}</b></div><div class="row"><span>IP</span><b>${esc(log.ip||'-')}</b></div></div>
    ${traceId?traceActions(traceId,'openAuditTrace'):stateBanner('warn','未发现 Trace pivot','该事件 detail_json 中没有 trace_id。')}
    ${auditActions}
    <details open><summary>detail_json</summary><pre class="code">${esc(JSON.stringify(log.detail_json||{},null,2))}</pre></details>
  </div>`;
}
function auditContentHtml(logs){
  const topActions=topCounts(logs,'action',6);
  const objectCounts=topCounts(logs,'object_type',5);
  const recent=logs.slice(0,10);
  return `<div class="audit-layout section-gap">
    <section class="audit-console"><div class="section-title"><div><h2>动作密度</h2><p>快速定位高频操作和关键资源类型，再下钻到原始日志。</p></div>${tag(`${logs.length} filtered`,'green')}</div><div class="audit-bars">${topActions.map(([name,count])=>`<div class="audit-bar-row"><span>${esc(displayValue(name))}</span><div><i style="width:${Math.max(8,Math.round(count/Math.max(1,topActions[0]?.[1]||1)*100))}%"></i></div><b>${count}</b></div>`).join('')||emptyState('暂无审计动作','产生登录、问数或审批后会显示动作密度。')}</div><div class="audit-objects">${objectCounts.map(([name,count])=>tag(`${displayValue(name)} ${count}`)).join('')}</div></section>
    <aside class="audit-timeline"><div class="section-title"><div><h2>最近事件</h2><p>点击事件查看明细和 Trace pivot。</p></div></div>${recent.length?recent.map(auditTimelineItem).join(''):emptyState('暂无事件','当前筛选范围没有审计日志。')}<div id="auditDetail" class="section-gap">${auditDetailHtml(recent[0])}</div></aside>
  </div>
  <div class="audit-trace-shell section-gap">${traceDrawer('auditTraceBox','审计关联 Trace','从审计事件 detail_json 中打开 Trace，复核输入、SQL、工具调用和执行步骤。')}</div>
  <div class="card section-gap"><div class="card-heading"><h3>原始审计日志</h3>${tag(`${logs.length} logs`)}</div>${renderTable(logs,{columns:['created_at','user_id','action','object_type','object_id','request_id','ip'],limit:160})}</div>`;
}
function refreshAuditView(){
  const query=document.getElementById('auditSearch')?.value||'';
  const action=document.getElementById('auditActionFilter')?.value||'';
  const objectType=document.getElementById('auditObjectFilter')?.value||'';
  const logs=auditLogsCache.filter(log=>auditLogMatches(log,query,action,objectType));
  const box=document.getElementById('auditContent');
  if(box) box.innerHTML=auditContentHtml(logs);
}
function selectAuditEvent(id){
  const log=auditLogsCache.find(x=>x.id===id);
  const box=document.getElementById('auditDetail');
  if(box) box.innerHTML=auditDetailHtml(log);
  const traceId=auditTraceId(log);
  if(traceId) openAuditTrace(traceId,'summary',null).catch(()=>{});
}
async function renderAudit(){
  const logs=await api('/api/admin/audit-logs').catch(()=>[]);
  auditLogsCache=logs;
  const topActions=topCounts(logs,'action',6);
  const objectCounts=topCounts(logs,'object_type',5);
  document.getElementById('page-audit').innerHTML=`${pageHeader('审计日志','集中查看登录、问数、审批、派发和数据访问等关键动作。',['Audit','Trace','RBAC'])}
  <div class="metric-grid tight">${metricCard('审计事件',logs.length,'最近 300 条以内')}${metricCard('动作类型',topActions.length,'登录、查询、审批、派发等')}${metricCard('对象类型',objectCounts.length,'被操作资源范围')}${metricCard('Trace pivot',logs.filter(auditTraceId).length,'可下钻执行链路')}</div>
  ${auditFilters(logs)}
  <div id="auditContent">${auditContentHtml(logs)}</div>`;
}

autoLogin();
