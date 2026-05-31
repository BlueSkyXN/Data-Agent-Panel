let token = localStorage.getItem('dap_token') || '';
let currentUser = null;
let agents = [];
let datasets = [];
let metrics = [];
let activePage = 'dashboard';
let currentTrace = null;
let lastAnalysisTaskId = '';
let lastSidebarTrigger = null;
let chatSending = false;
let chatSessions = [];
let chatSessionFilter = {status:'active', q:''};
let answerDraftCache = {};
let activeSessionId = '';
let commandItems = [];
let commandIndex = 0;
let pendingEvidenceTarget = '';
let knowledgeBasesCache = [];
let knowledgeVersionCache = {};
let auditLogsCache = [];
let activeAgentDetailId = '';
let panelCatalogCache = [];
let activePanelId = '';
let evalSetsCache = [];
let evalCaseCache = {};
let activeEvalSetId = '';
let semanticFilterState = {q:'', domain:''};

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
  metric:'指标',business_term:'业务术语',topn:'TopN',trend:'趋势',distribution:'分布',roi:'ROI',
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
function compactTags(values,limit=4){
  const list=[...new Set((values||[]).filter(Boolean))].slice(0,limit);
  return list.length?list.map(v=>tag(v)).join(''):'<span class="muted">暂无标签</span>';
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
function datasetCard(d){
  return `<div class="asset-card"><div class="asset-card-head"><div><b>${esc(d.name)}</b><span>${esc(d.physical_table||d.id)}</span></div>${statusTag(d.status)}</div><p>${esc(d.description||'暂无说明')}</p><div>${tag(d.business_domain||'Domain')}${statusTag(d.data_classification)}${statusTag(d.refresh_mode)}</div><div class="asset-actions"><button class="report-action" onclick="openDatasetDetail('${jsArg(d.id)}',this)">详情</button><button class="report-action" onclick="dataTab('query',document.querySelector('#page-dataops .tabs button[data-tab=&quot;query&quot;]'));setTimeout(()=>{document.getElementById('qDataset').value='${jsArg(d.id)}';syncWorkbenchSql()},60)">查询</button><button class="report-action" onclick="dataTab('profile',document.querySelector('#page-dataops .tabs button[data-tab=&quot;profile&quot;]'));setTimeout(()=>{document.getElementById('profileDataset').value='${jsArg(d.id)}'},60)">画像</button></div></div>`;
}
function promptButton(q){return `<button class="prompt-pill" onclick="askPreset('${jsArg(q)}')">${esc(q)}</button>`}
function percent(v){return Math.max(0,Math.min(100,Math.round(Number(v||0)*100)))}
function agentCard(a){
  return `<div class="agent-card">
    <div class="agent-card-head"><div><b>${esc(a.name)}</b><span>${esc(a.id)}</span></div>${statusTag(a.status)}</div>
    <p>${esc(a.description||'暂无说明')}</p>
    <div class="agent-tags">${tag(a.type||'agent')}${statusTag(a.risk_level||'low')}${a.adapter_id?tag(a.adapter_id):''}</div>
    <div class="agent-meta"><span>Version ${esc(a.version||'-')}</span><span>${esc(a.owner_id||'platform')}</span></div>
    <div class="agent-actions"><button class="secondary" onclick="showPage('chat');setTimeout(()=>{document.getElementById('chatAgent').value='${jsArg(a.id)}'},60)">试用</button><button class="ghost" onclick="openAgentDetail('${jsArg(a.id)}')">详情</button></div>
  </div>`;
}
function agentMiniCard(a){
  return `<button class="agent-mini-card ${a.id===activeAgentDetailId?'active':''}" data-agent-id="${esc(a.id)}" onclick="openAgentDetail('${jsArg(a.id)}')">
    <span>${esc(displayValue(a.type||'agent'))}</span><b>${esc(a.name)}</b><p>${esc(short(a.description||a.id,88))}</p><div>${statusTag(a.status)}${statusTag(a.risk_level||'low')}${a.adapter_id?tag(a.adapter_id):''}</div>
  </button>`;
}
function reportCard(r){
  const flow=['draft','pending_review','approved','published'];
  const idx=Math.max(0,flow.indexOf(r.status||'draft'));
  return `<article class="report-card">
    <div class="report-card-head"><div><span>${esc(r.report_type||'report')}</span><b>${esc(r.title||r.id)}</b></div>${statusTag(r.status||'draft')}</div>
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
  if(r.status==='pending_review') buttons.push(`<button class="report-action" onclick="runReportAction('${id}','approve',this)">批准</button>`);
  if(r.status==='approved') buttons.push(`<button class="report-action" onclick="runReportAction('${id}','publish',this)">发布</button>`);
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
  const reportTitle=report.title||report.id;
  const reportId=report.id||reportTitle;
  const reportActions=contextActionStrip([
    {label:'继续追问',onclick:`setChatDraft('${jsArg(`基于报告“${reportTitle}”继续追问：请解释核心结论、证据来源和下一步建议。`)}','agent_router')`},
    {label:'转深度研究',onclick:`setAnalysisDraft('${jsArg(`基于报告“${reportTitle}”继续做深度复盘：核对证据、风险点和可执行改进项。`)}','agent_business_analysis')`},
    {label:'创建 Codex 任务',onclick:`setCodexDraft('${jsArg(`改进报告体验：${reportTitle}`)}','${jsArg(`围绕报告 ${reportId} 检查报告中心体验、证据 Trace 入口和上下文动作，保持 RBAC、SQL Guard、Trace 和审计能力不退化。`)}')`},
    {label:'查看审计',onclick:`openAuditFiltered('${jsArg(reportId)}')`}
  ]);
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
  return `<button class="knowledge-card" onclick="selectKnowledgeBase('${jsArg(k.id)}')">
    <div class="knowledge-icon">${esc((k.type||'K').slice(0,2).toUpperCase())}</div>
    <div><div class="knowledge-head"><b>${esc(k.name||k.id)}</b>${statusTag(k.status||'active')}</div>
    <p>${esc(k.description||'暂无说明')}</p>
    <div class="knowledge-meta">${tag(k.backend_type||'backend')}${k.adapter_id?tag(k.adapter_id):''}${tag(`${versions.length||0} versions`,'green')}</div></div>
  </button>`;
}
function evalSetCard(s,cases=[]){
  const tags=[...new Set(cases.flatMap(c=>Array.isArray(c.tags)?c.tags:[]))];
  return `<button class="eval-card ${s.id===activeEvalSetId?'active':''}" data-eval-set-id="${esc(s.id)}" onclick="selectEvalSet('${jsArg(s.id)}')">
    <div class="eval-card-head"><div><span>${esc(s.business_domain||'Evaluation')}</span><b>${esc(s.name||s.id)}</b></div>${tag(`${cases.length} cases`,'green')}</div>
    <p>${esc(s.description||'暂无说明')}</p>
    <div class="eval-tags">${compactTags(tags,5)}</div>
  </button>`;
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
}
async function copyAnswerText(text,btn){
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
    toast('答案已复制');
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
    `<button class="answer-tool" data-prompt="${esc(research)}" onclick="setAnalysisDraft(this.dataset.prompt,'agent_business_analysis')">转深度研究</button>`,
    `<button class="answer-tool" data-title="优化问数工作流" data-prompt="${esc(codexPrompt)}" onclick="setCodexDraft(this.dataset.title,this.dataset.prompt)">创建 Codex 任务</button>`,
    key?`<button class="answer-tool" onclick="saveAnswerAsReport('${jsArg(key)}',this)">保存报告</button>`:'',
    traceId?`<button class="answer-tool" onclick="openEvidence('${jsArg(traceId)}','steps')">定位证据</button>`:'',
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
function resultHtml(r, meta={}){
  const answerKey=cacheAnswerDraft(r,meta);
  return `<div class="answer-title">${tag('Agent Response','green')}<b>${esc(r.answer||'已返回结果')}</b>${traceButton(r.trace_id||meta.trace_id)}</div>
  ${answerBrief(r,meta)}
  ${answerContextActions(r,meta,answerKey)}
  ${evidenceLinks(r,meta)}
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
  if(message.role==='user') return `<div class="message user">${esc(message.content)}</div>`;
  const parsed=message.content_type==='agent_result'?parseJsonMaybe(message.content):null;
  return `<div class="message assistant rich-message">${parsed?resultHtml(parsed,{session_id:sessionId,message_id:message.id,trace_id:parsed.trace_id,question:previousUserMessage(messages,index)}):esc(message.content)}</div>`;
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
function buildCommandItems(q){
  const items=[];
  if(q) items.push({kind:'ask',title:'向 Data Agent 提问',description:q,keywords:'ask chat question',run:()=>askGlobalQuery(q)});
  items.push(...pageCommandDefinitions());
  items.push(...agents.map(a=>({kind:'agent',title:a.name,description:`试用 ${displayValue(a.type)} · ${displayValue(a.risk_level||'low')}`,keywords:[a.id,a.type,a.description,a.adapter_id].join(' '),run:()=>openAgentCommand(a.id)})));
  items.push(...datasets.map(d=>({kind:'dataset',title:d.name,description:`打开数据画像 · ${d.physical_table||d.id}`,keywords:[d.id,d.business_domain,d.description,d.data_classification].join(' '),run:()=>openDatasetCommand(d.id)})));
  items.push(...metrics.map(m=>({kind:'metric',title:m.name,description:`解释指标口径 · ${m.code||m.id}`,keywords:[m.id,m.code,m.formula,m.dataset_id].join(' '),run:()=>openMetricCommand(m)})));
  const prompts=['本月收入最高的渠道有哪些？','按区域统计本月收入','客户工单根因分布是什么？','解释收入指标口径','给我生成一个经营总览面板','帮我创建一个 Codex 任务，开发面板导出功能'];
  items.push(...prompts.map(p=>({kind:'prompt',title:p,description:'推荐问题',keywords:'prompt question sample',run:()=>askGlobalQuery(p)})));
  return items.filter(item=>commandMatch(item,q)).slice(0,12);
}
function renderCommandMenu(){
  const input=document.getElementById('globalSearch'), menu=document.getElementById('commandMenu');
  if(!input||!menu||document.getElementById('app')?.classList.contains('hidden')) return;
  const q=input.value.trim();
  commandItems=buildCommandItems(q);
  commandIndex=0;
  input.setAttribute('aria-expanded','true');
  menu.classList.remove('hidden');
  menu.innerHTML=`<div class="command-head"><b>全局指挥入口</b><span>Ctrl/⌘ K</span></div>${commandItems.length?commandItems.map((item,i)=>`<button role="option" aria-selected="${i===commandIndex}" class="command-item ${i===commandIndex?'active':''}" onmousedown="event.preventDefault()" onclick="runCommandItem(${i})"><span>${esc(displayValue(item.kind))}</span><div><b>${esc(item.title)}</b><p>${esc(item.description||'')}</p></div></button>`).join(''):emptyState('没有匹配结果','换一个页面、Agent、数据集、指标或业务问题试试。')}`;
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
async function bootstrap(){await refreshCatalog(); showPage(initialPageFromLocation());}
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
  const highRisk=agents.filter(a=>a.risk_level==='high').length;
  activeAgentDetailId=activeAgentDetailId||agents[0]?.id||'';
  document.getElementById('page-agents').innerHTML=`${pageHeader('Agent Studio','按能力域查看内置 Agent、风险等级、Adapter 绑定和可试用入口。',['Gateway','Adapters','RBAC'])}
  <div class="metric-grid tight">${metricCard('Agent 总数',agents.length,'当前可用能力单元')}${metricCard('能力类型',Object.keys(groups).length,'路由、问数、研究、治理等')}${metricCard('高风险 Agent',highRisk,'需保留审批和审计')}${metricCard('外部 Adapter',agents.filter(a=>a.adapter_id).length,'可接入 Dify / RAGFlow 等')}</div>
  <div class="agent-studio section-gap">
    <section class="agent-directory">
      <div class="section-title"><div><h2>能力目录</h2><p>按 Agent 类型组织，选择一个能力后在右侧查看版本、知识绑定和可用动作。</p></div>${tag(`${agents.length} agents`)}</div>
      <div class="agent-mini-list">${Object.entries(groups).map(([type,list])=>`<div class="agent-mini-section"><h3>${esc(displayValue(type))}</h3>${list.map(agentMiniCard).join('')}</div>`).join('')}</div>
    </section>
    <aside class="agent-inspector" id="agentDetail">${emptyState('正在加载 Agent','选择 Agent 后显示版本、知识绑定和试用入口。')}</aside>
  </div>`;
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
  <div class="agent-inspector-actions"><button onclick="showPage('chat');setTimeout(()=>{document.getElementById('chatAgent').value='${jsArg(a.id)}'},80)">在问数中试用</button><button class="secondary" onclick="showPage('analysis');setTimeout(()=>{const s=document.getElementById('analysisAgent'); if(s&&[...s.options].some(o=>o.value==='${jsArg(a.id)}')) s.value='${jsArg(a.id)}'},80)">用于研究</button><button class="ghost" onclick="showPage('audit')">查看审计</button></div>
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
        <input id="sessionSearch" placeholder="搜索会话" value="${esc(chatSessionFilter.q)}" oninput="chatSessionFilter.q=this.value;renderSessionList()" aria-label="搜索会话"/>
        <div class="session-filter" role="tablist" aria-label="会话状态">
          <button class="${chatSessionFilter.status==='active'?'active':''}" onclick="setSessionFilter('active',this)">活跃</button>
          <button class="${chatSessionFilter.status==='archived'?'active':''}" onclick="setSessionFilter('archived',this)">归档</button>
          <button class="${chatSessionFilter.status==='all'?'active':''}" onclick="setSessionFilter('all',this)">全部</button>
        </div>
      </div>
      <div id="chatSessionList">${inlineLoading('正在读取会话')}</div>
      <div class="context-card">
        <b>工作上下文</b>
        <label class="field-label" for="chatAgent">Agent</label><select id="chatAgent" onchange="detachChatSessionForAgent()">${agentOptions()}</select>
        <label class="field-label" for="chatDataset">数据集</label><select id="chatDataset"><option value="">自动选择</option>${datasetOptions()}</select>
        <label class="field-label" for="traceDepth">证据深度</label><select id="traceDepth"><option value="standard">标准 Trace</option><option value="full">完整证据</option></select>
      </div>
    </aside>
    <section class="chat-stage">
      <div class="chat-stage-head"><div><span>Data Agent</span><b id="chatSessionTitle">新对话</b></div><div class="tool-strip" id="toolMode"><button class="active" data-mode="auto" onclick="setToolMode('auto',this)">自动</button><button data-mode="analysis" onclick="setToolMode('analysis',this)">分析</button><button data-mode="sql" onclick="setToolMode('sql',this)">SQL</button><button data-mode="codex" onclick="setToolMode('codex',this)">Codex</button></div></div>
      <div id="chatMessages" class="chat-thread">${chatEmptyState()}</div>
      <div class="composer-card">
        <div class="prompt-list compact">${prompts.map(promptButton).join('')}</div>
        <div class="composer-row"><textarea id="chatInput" rows="2" placeholder="询问数据、要求生成图表、解释指标，或创建工程任务" onkeydown="if(event.key==='Enter'&&!event.shiftKey){event.preventDefault();sendChat()}"></textarea><button onclick="sendChat(this)" aria-label="发送消息">发送</button></div>
        <div class="composer-meta"><span>Enter 发送，Shift+Enter 换行</span><span>SQL Guard / RBAC / Trace 始终保留</span></div>
      </div>
    </section>
    <aside class="evidence-drawer trace-pane">
      <div class="pane-title"><span>Trace</span><div><h2>证据</h2><p>SQL、工具调用和执行步骤在这里复核。</p></div></div>
      <div id="traceBox">${emptyState('暂无 Trace','发送问题后会显示执行状态、SQL、工具调用与步骤输出。')}</div>
    </aside>
  </div>`;
  const router=agents.find(a=>a.id==='agent_router'); if(router) document.getElementById('chatAgent').value=router.id;
  refreshChatSessions().catch(()=>{document.getElementById('chatSessionList').innerHTML=emptyState('会话读取失败','仍可直接开始新对话。')});
}
function chatEmptyState(){
  return `<div class="chat-welcome"><div class="assistant-mark">DA</div><h2>今天要分析什么？</h2><p>选择数据上下文后直接提问。业务答案留在中间，SQL、工具和审批证据留在右侧。</p></div>`;
}
function setToolMode(mode,btn){
  document.querySelectorAll('#toolMode button').forEach(b=>b.classList.toggle('active',b===btn||b.dataset.mode===mode));
}
function selectedChatContext(){
  return {
    dataset_id:document.getElementById('chatDataset')?.value||null,
    tool_mode:document.querySelector('#toolMode button.active')?.dataset.mode||'auto',
    evidence_depth:document.getElementById('traceDepth')?.value||'standard'
  };
}
function setSessionFilter(status,btn){
  chatSessionFilter.status=status;
  document.querySelectorAll('.session-filter button').forEach(b=>b.classList.toggle('active',b===btn||b.textContent.includes(status==='active'?'活跃':status==='archived'?'归档':'全部')));
  renderSessionList();
}
function sessionMatches(s){
  const status=chatSessionFilter.status||'active';
  const q=(chatSessionFilter.q||'').trim().toLowerCase();
  const okStatus=status==='all' || (s.status||'active')===status;
  const haystack=[s.title,s.id,s.agent_id,s.status].filter(Boolean).join(' ').toLowerCase();
  return okStatus && (!q || haystack.includes(q));
}
function sessionCard(s){
  const archived=(s.status||'active')==='archived';
  return `<article class="session-item ${s.id===activeSessionId?'active':''} ${archived?'archived':''}">
    <button class="session-open" onclick="loadChatSession('${jsArg(s.id)}')"><b>${esc(sessionTitle(s))}</b><span>${esc(timeText(s.updated_at))} · ${esc(s.agent_id||'auto')}</span></button>
    <div class="session-actions">
      <button title="重命名会话" onclick="renameChatSession('${jsArg(s.id)}',this)">改名</button>
      <button title="${archived?'恢复会话':'归档会话'}" onclick="toggleChatSessionArchive('${jsArg(s.id)}',${archived},this)">${archived?'恢复':'归档'}</button>
    </div>
  </article>`;
}
function renderSessionList(){
  const box=document.getElementById('chatSessionList');
  if(!box) return;
  const filtered=chatSessions.filter(sessionMatches);
  box.innerHTML=filtered.length?filtered.slice(0,40).map(sessionCard).join(''):emptyState('暂无匹配会话','调整搜索或切换活跃/归档状态。');
}
async function refreshChatSessions(){
  chatSessions=await api('/api/sessions').catch(()=>[]);
  renderSessionList();
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
function startNewChat(){
  activeSessionId='';
  currentTrace=null;
  const title=document.getElementById('chatSessionTitle'); if(title) title.innerText='新对话';
  const box=document.getElementById('chatMessages'); if(box) box.innerHTML=chatEmptyState();
  const trace=document.getElementById('traceBox'); if(trace) trace.innerHTML=emptyState('暂无 Trace','发送问题后会显示执行状态、SQL、工具调用与步骤输出。');
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
    activeSessionId=session.id;
    const title=document.getElementById('chatSessionTitle'); if(title) title.innerText=session.title||session.id;
    const agentSelect=document.getElementById('chatAgent'); if(agentSelect&&session.agent_id) agentSelect.value=session.agent_id;
    const messages=session.messages||[];
    if(box) box.innerHTML=messages.length?messages.map((m,i)=>chatMessageHtml(m,session.id,messages,i)).join(''):chatEmptyState();
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
async function sendChat(btn){
  if(chatSending) return;
  const input=document.getElementById('chatInput'); const msg=input.value.trim(); if(!msg) return; const agent_id=document.getElementById('chatAgent').value;
  chatSending=true;
  const sendButton=btn||document.querySelector('#page-chat .composer-row button');
  setBusy(sendButton,true);
  input.disabled=true;
  const box=document.getElementById('chatMessages');
  if(box.querySelector('.chat-welcome')) box.innerHTML='';
  box.innerHTML+=`<div class="message user">${esc(msg)}</div>`; input.value='';
  const pendingId='pending-'+Date.now();
  box.innerHTML+=`<div id="${pendingId}" class="message assistant pending-message">${inlineLoading('Agent 正在路由和生成答案')}</div>`;
  try{
    const data=await api('/api/chat/query',{method:'POST',body:JSON.stringify({message:msg,agent_id,session_id:activeSessionId||null,context:selectedChatContext()})}); const r=data.result||{};
    activeSessionId=data.session_id||activeSessionId;
    const title=document.getElementById('chatSessionTitle'); if(title) title.innerText=sessionTitle({title:msg});
    document.getElementById(pendingId)?.remove();
    box.innerHTML+=`<div class="message assistant rich-message">${resultHtml(r,{session_id:activeSessionId,trace_id:data.trace_id,question:msg})}</div>`;
    await openTrace(data.trace_id);
    await refreshChatSessions();
  }catch(e){const p=document.getElementById(pendingId); if(p) p.innerHTML=stateBanner('error','问数失败',e.message); else box.innerHTML+=`<div class="message assistant">${stateBanner('error','问数失败',e.message)}</div>`}
  finally{chatSending=false; input.disabled=false; setBusy(sendButton,false)}
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

async function openDatasetDetail(id,btn){
  const box=document.getElementById('datasetDetail');
  if(!box) return;
  setBusy(btn,true);
  box.innerHTML=inlineLoading('正在读取数据集字段和操作入口');
  try{
    const dataset=datasets.find(d=>d.id===id)||{id};
    const fields=await api('/api/datasets/'+id+'/fields').catch(()=>[]);
    const relatedMetrics=metrics.filter(m=>m.dataset_id===id||m.dataset_name===dataset.name);
    box.innerHTML=`<div class="dataset-detail">
      <div class="card-heading"><div><h3>${esc(dataset.name||id)}</h3><p class="muted">${esc(dataset.physical_table||id)} · ${esc(dataset.business_domain||'-')}</p></div>${statusTag(dataset.data_classification||'internal')}</div>
      <p>${esc(dataset.description||'暂无数据集说明')}</p>
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
  if(name==='catalog'){box.innerHTML=`<div class="metric-grid tight">${metricCard('数据集',datasets.length,'已注册业务数据资产')}${metricCard('指标',metrics.length,'可复用口径与语义')}${metricCard('敏感数据集',datasets.filter(d=>d.data_classification==='confidential').length,'需保持 masking 与 RBAC')}${metricCard('业务域',new Set(datasets.map(d=>d.business_domain).filter(Boolean)).size,'跨域治理范围')}</div><div class="data-catalog-workspace section-gap"><section><div class="asset-grid">${datasets.map(datasetCard).join('')}</div><div class="card section-gap"><h3>指标口径</h3>${renderTable(metrics,{columns:['name','code','dataset_name','formula','time_grain','status'],limit:80})}</div></section><aside id="datasetDetail" class="dataset-detail-card">${emptyState('选择数据集','点击数据集卡片的详情按钮查看字段、指标和后续动作。')}</aside></div>`; if(datasets[0]) openDatasetDetail(datasets[0].id,null).catch(()=>{});}
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
  const statusCounts=countBy(reports,'status');
  const latest=reports[0];
  document.getElementById('page-reports').innerHTML=`${pageHeader('报告中心','管理 AI 生成报告的草稿、复核、批准和发布状态。',['Draft','Review','Publish'])}
  <div class="metric-grid tight">${metricCard('报告资产',reports.length,'AI 生成和人工复核的报告')}${metricCard('待复核',statusCounts.pending_review||0,'需要人工确认')}${metricCard('已批准',statusCounts.approved||0,'可进入发布')}${metricCard('最近更新',latest?timeText(latest.updated_at||latest.created_at):'-','报告链路最新动作')}</div>
  <div class="report-workspace section-gap">
    <section class="report-stream"><div class="section-title"><div><h2>报告资产流</h2><p>左侧扫读状态，右侧像 Canvas 一样查看正文、版本、证据和 Trace。</p></div>${tag(`${reports.length} reports`)}</div><div class="report-grid">${reports.length?reports.map(reportCard).join(''):emptyState('暂无报告','完成深度研究或报告生成后，这里会显示草稿、复核和发布状态。')}</div><div class="card section-gap"><div class="card-heading"><h3>报告明细</h3>${tag('audit fields')}</div>${renderTable(reports,{columns:['id','title','status','report_type','owner_id','created_at','updated_at'],limit:80})}</div></section>
    <aside class="report-side">
      <div id="reportDetail">${latest?`<button class="secondary" onclick="openReportDetail('${jsArg(latest.id)}',this)">打开最近报告</button>`:emptyState('未选择报告','选择报告后会显示正文、版本和证据。')}</div>
      ${traceDrawer('reportTraceBox','报告证据','从报告 evidence_json 中打开 Trace，复核 SQL、权限和执行步骤。')}
      <div class="workflow-card section-gap"><h3>报告状态流</h3>${workflowRail([['草稿生成','Agent 输出报告草稿并关联证据。'],['提交复核','业务 owner 或分析师发起 review。'],['管理员批准','人工确认口径、证据和风险。'],['发布分发','进入业务侧阅读和归档。']])}</div>
    </aside>
  </div>
  `;
}
async function openReportDetail(id, btn){
  const box=document.getElementById('reportDetail');
  if(!box) return;
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
  const backendCounts=countBy(kbs,'backend_type');
  const adapterOptions=[...new Set([...kbs.map(k=>k.adapter_id).filter(Boolean),...agents.map(a=>a.adapter_id).filter(Boolean)])].map(id=>`<option value="${esc(id)}">${esc(id)}</option>`).join('');
  document.getElementById('page-knowledge').innerHTML=`${pageHeader('知识库','注册知识库、绑定 Agent、管理版本与引用权限，可对接 RAGFlow / Dify Knowledge。',['Knowledge binding','Versioning','Permissions'])}
  <div class="metric-grid tight">${metricCard('知识库',kbs.length,'已注册外部知识源')}${metricCard('后端类型',Object.keys(backendCounts).length,'RAGFlow、Dify 或 mock')}${metricCard('活跃版本',versionLists.flat().filter(v=>v.status==='active').length,'可被 Agent 引用')}${metricCard('Adapter',new Set(kbs.map(k=>k.adapter_id).filter(Boolean)).size,'外部连接点')}</div>
  <div class="knowledge-workspace section-gap">
    <section class="ops-main"><div class="section-title"><div><h2>知识资产</h2><p>关注知识源、后端、版本和绑定入口，不在平台内复制真实知识内容。</p></div>${tag(`${kbs.length} bases`)}</div><div class="knowledge-grid">${kbs.length?kbs.map((k,i)=>knowledgeCard(k,versionLists[i]||[])).join(''):emptyState('暂无知识库','注册知识库后，Agent 可通过绑定关系引用外部知识。')}</div><div class="card section-gap"><div class="card-heading"><h3>知识库明细</h3>${tag('registry')}</div>${renderTable(kbs,{columns:['id','name','type','backend_type','adapter_id','description','status'],limit:80})}</div></section>
    <aside class="knowledge-side">
      <div class="card form-shell"><h3>注册知识库</h3><p class="muted">只登记外部知识源和 Adapter，不在前端保存真实知识内容。</p><label class="field-label" for="kbName">名称</label><input id="kbName" value="经营政策知识库"/><div class="form-row"><div><label class="field-label" for="kbType">类型</label><select id="kbType"><option value="document">document</option><option value="faq">faq</option><option value="table">table</option></select></div><div><label class="field-label" for="kbBackend">后端</label><select id="kbBackend"><option value="mock">mock</option><option value="ragflow">ragflow</option><option value="dify">dify</option></select></div></div><label class="field-label" for="kbAdapter">Adapter</label><input id="kbAdapter" list="kbAdapterOptions" placeholder="ad_knowledge"/><datalist id="kbAdapterOptions">${adapterOptions}</datalist><label class="field-label" for="kbDescription">说明</label><textarea id="kbDescription">用于问数和报告生成时引用经营政策、产品口径和客服知识。</textarea><button onclick="createKnowledgeBase(this)">注册</button><div id="knowledgeCreateResult"></div></div>
      <div id="knowledgeDetail" class="card section-gap">${knowledgeDetailHtml(kbs[0],versionLists[0]||[])}</div>
      <div class="workflow-card section-gap"><h3>接入策略</h3>${workflowRail([['注册','记录知识库、后端类型和 Adapter。'],['版本','维护可回溯版本与 checksum。'],['绑定','按 Agent 能力域授权引用。'],['审计','保留创建、版本和引用动作。']])}</div>
    </aside>
  </div>`;
}
async function renderEvals(){
  const sets=await api('/api/eval-sets').catch(()=>[]);
  const caseLists=await Promise.all(sets.map(s=>api(`/api/eval-sets/${s.id}/cases`).catch(()=>[])));
  evalSetsCache=sets;
  evalCaseCache=Object.fromEntries(sets.map((s,i)=>[s.id,caseLists[i]||[]]));
  activeEvalSetId=activeEvalSetId || sets[0]?.id || '';
  const totalCases=caseLists.flat().length;
  document.getElementById('page-evals').innerHTML=`${pageHeader('评测中心','用评测集对 Agent 回答质量、路由、SQL Guard 和回归结果做持续检查。',['Eval sets','Regression','Quality gate'])}
  <div class="metric-grid tight">${metricCard('评测集',sets.length,'覆盖业务问数和多 Agent 能力')}${metricCard('用例',totalCases,'问题、期望 SQL 和标签')}${metricCard('可测 Agent',agents.length,'当前权限范围内')}${metricCard('默认门槛','0.80','建议作为回归判定线')}</div>
  <div class="eval-workstation section-gap">
    <section class="ops-main"><div class="section-title"><div><h2>评测资产</h2><p>先看覆盖范围，再选择评测集与 Agent 运行回归。</p></div>${tag(`${totalCases} cases`)}</div><div class="eval-grid">${sets.length?sets.map((s,i)=>evalSetCard(s,caseLists[i]||[])).join(''):emptyState('暂无评测集','创建评测集后可用于问数、路由和 SQL Guard 回归。')}</div><div id="evalCasePreview" class="section-gap">${evalCasePreviewHtml(activeEvalSetId)}</div></section>
    <aside class="eval-side">
      <div class="card form-shell eval-runner"><h3>运行评测</h3><p class="muted">选择评测集和 Agent，生成结果明细；运行会写入 Trace 与审计。</p><label class="field-label" for="evalSet">评测集</label><select id="evalSet" onchange="selectEvalSet(this.value)">${evalSetOptions(sets,activeEvalSetId)}</select><label class="field-label" for="evalAgent">Agent</label><select id="evalAgent">${agentOptions()}</select><button onclick="runEval(this)">运行评测</button><div id="evalResult"></div></div>
      <div class="card form-shell eval-create-card"><h3>创建评测集</h3><p class="muted">把新的业务场景沉淀为可重复运行的回归套件。</p><label class="field-label" for="evalSetName">名称</label><input id="evalSetName" value="经营分析回归集"/><div class="form-row"><div><label class="field-label" for="evalSetDomain">业务域</label><input id="evalSetDomain" value="Business"/></div><button onclick="createEvalSet(this)">创建</button></div><label class="field-label" for="evalSetDescription">说明</label><textarea id="evalSetDescription">覆盖常见经营问数、SQL Guard、图表和 Trace 证据链。</textarea><div id="evalSetCreateResult"></div></div>
      <div class="card form-shell eval-create-card"><h3>添加用例</h3><p class="muted">一条用例就是一个可回放问题，可带期望 SQL 与标签。</p><label class="field-label" for="evalCaseSet">目标评测集</label><select id="evalCaseSet">${evalSetOptions(sets,activeEvalSetId)}</select><label class="field-label" for="evalCaseQuestion">问题</label><textarea id="evalCaseQuestion">按渠道统计本月收入，并说明最高渠道。</textarea><label class="field-label" for="evalCaseSql">期望 SQL</label><textarea id="evalCaseSql">${esc(sampleSqlForDataset(defaultQueryDataset()))}</textarea><input id="evalCaseTags" value="收入, SQL Guard, Trace" aria-label="标签"/><button onclick="createEvalCase(this)">添加用例</button><div id="evalCaseCreateResult"></div></div>
    </aside>
  </div>`;
}
function evalSetOptions(sets=[],selected=''){
  return sets.length?sets.map(s=>`<option value="${esc(s.id)}" ${s.id===selected?'selected':''}>${esc(s.name)}</option>`).join(''):'<option value="">暂无评测集</option>';
}
function evalCasePreviewHtml(setId){
  const set=evalSetsCache.find(s=>s.id===setId);
  const cases=evalCaseCache[setId]||[];
  if(!setId) return emptyState('未选择评测集','创建或选择评测集后会显示用例清单。');
  return `<div class="eval-case-preview"><div class="card-heading"><div><h3>${esc(set?.name||setId)}</h3><p class="muted">${esc(set?.description||'暂无说明')}</p></div>${tag(`${cases.length} cases`,'green')}</div>${cases.length?renderTable(cases,{columns:['question','expected_sql','tags'],limit:80,compact:true}):emptyState('暂无用例','在右侧添加第一条业务问题。')}</div>`;
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
