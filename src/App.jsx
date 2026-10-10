import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import {
  Activity, HeartPulse, LayoutDashboard, ClipboardList, BrainCircuit, Network, Menu, X,
  Bell, Search, ChevronRight, ArrowUpRight, ArrowDownRight, Wifi, WifiOff, ShieldCheck,
  Stethoscope, UserRound, LogOut, Play, RefreshCw, CircleHelp, Settings, Clock3, Check,
  AlertTriangle, Waves, Gauge, Sparkles, LockKeyhole, Mail, Eye, EyeOff, FileHeart,
  MoreHorizontal, Download, Zap, CircleCheck, LoaderCircle
} from 'lucide-react';
import { api, LABELS, asRecords, validSpo2 } from './api';

const DEMO_USER = { email: 'patient@cardioguard.demo', password: 'cardio123', name: 'Alex Morgan', role: 'patient' };
const DEMO_DOCTOR = { email: 'doctor@cardioguard.demo', password: 'doctor123', name: 'Dr. Maya Chen', role: 'doctor' };
const initialCapture = {
  id: 1042, device_id: 1, prediction: 1, prediction_label: 'N',
  ecg_info: [Array.from({length: 180}, (_, i) => 0.13*Math.sin(i/7) + (i%36===18 ? 0.9 : 0) + 0.035*Math.sin(i*1.7))],
  oxygen_info: [Array.from({length: 180}, (_, i) => 97 + Math.sin(i/22)*1.1 + Math.sin(i/5)*0.35)]
};

function getSavedUser() {
  try { return JSON.parse(sessionStorage.getItem('cg_user') || 'null'); } catch { return null; }
}
function IconLogo({ small=false }) {
  return <div className={`brand-mark ${small ? 'brand-mark-small' : ''}`}><HeartPulse size={small ? 20 : 24} strokeWidth={2.3}/></div>;
}
function Brand({ compact=false }) {
  return <div className="brand"><IconLogo small={compact}/><div className="brand-copy"><strong>cardio<span>guard</span></strong>{!compact && <small>EDGE HEALTH MONITORING</small>}</div></div>;
}
function Badge({ children, tone='neutral', dot=false }) {
  return <span className={`badge badge-${tone}`}>{dot && <i/>}{children}</span>;
}
function Button({ children, variant='primary', size='', icon: Icon, ...props }) {
  return <button className={`btn btn-${variant} ${size ? `btn-${size}` : ''}`} {...props}>{Icon && <Icon size={16}/>}<span>{children}</span></button>;
}
function PageHeader({ eyebrow, title, subtitle, action }) {
  return <div className="page-header"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{subtitle}</p></div>{action && <div className="page-header-action">{action}</div>}</div>;
}
function ECGLine({ data, height=116, color='#43d9c4', id='ecg', fill=false }) {
  const values = Array.isArray(data) && data.length ? data : Array.from({length:120}, (_,i)=>Math.sin(i/8)*.12);
  const min = Math.min(...values, -0.25), max = Math.max(...values, 0.45);
  const points = values.map((v,i)=>`${(i/(Math.max(1,values.length-1)))*800},${height-8-((v-min)/(max-min || 1))*(height-16)}`).join(' ');
  const area = `0,${height} ${points} 800,${height}`;
  return <svg className="ecg-svg" viewBox={`0 0 800 ${height}`} preserveAspectRatio="none" role="img" aria-label="ECG waveform">
    <defs><pattern id={`${id}-grid`} width="32" height="24" patternUnits="userSpaceOnUse"><path d="M 32 0 L 0 0 0 24" fill="none" stroke="currentColor" strokeWidth=".65" opacity=".5"/></pattern><linearGradient id={`${id}-fade`} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={color} stopOpacity=".2"/><stop offset="100%" stopColor={color} stopOpacity="0"/></linearGradient></defs>
    <rect width="800" height={height} fill={`url(#${id}-grid)`}/>{fill && <polygon points={area} fill={`url(#${id}-fade)`}/>}
    <polyline points={points} fill="none" stroke={color} strokeWidth="2.4" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke"/>
  </svg>;
}
function makeWave(n=180) {
  return Array.from({length:n}, (_,i) => {
    const p=i%36;
    const spike = p===17 ? 1 : p===18 ? .45 : p===19 ? -.3 : 0;
    const bump = p>5&&p<11 ? Math.sin((p-5)/6*Math.PI)*.13 : 0;
    return Math.sin(i*.11)*.025 + spike + bump;
  });
}
function Sparkline({ data, color='#45d9c6' }) {
  const values = data?.length ? data : [2,3,2,4,3,5,4,6,4,7];
  const min=Math.min(...values), max=Math.max(...values);
  const points=values.map((v,i)=>`${i/(values.length-1||1)*100},${28-(v-min)/(max-min||1)*24}`).join(' ');
  return <svg viewBox="0 0 100 30" className="sparkline"><polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/></svg>;
}
function GaugeChart({ value=97 }) {
  const pct=Math.max(0,Math.min(100,(value-50)/50));
  const r=66, c=2*Math.PI*r, dash=c*.75;
  const color=value>=95?'#43d9a4':value>=90?'#f3b65b':'#ff6d78';
  return <div className="gauge-wrap"><svg viewBox="0 0 180 145" className="gauge-svg">
    <circle cx="90" cy="86" r={r} fill="none" stroke="#213547" strokeWidth="12" strokeDasharray={`${dash} ${c-dash}`} strokeLinecap="round" transform="rotate(135 90 86)"/>
    <circle cx="90" cy="86" r={r} fill="none" stroke={color} strokeWidth="12" strokeDasharray={`${dash*pct} ${c-dash*pct}`} strokeLinecap="round" transform="rotate(135 90 86)" style={{transition:'stroke-dasharray .7s'}}/>
    <text x="90" y="83" textAnchor="middle" className="gauge-number">{Math.round(value)}<tspan className="gauge-percent">%</tspan></text><text x="90" y="105" textAnchor="middle" className="gauge-caption">SpO₂</text>
  </svg></div>;
}
function StatCard({ label, value, unit, icon: Icon, trend, tone='teal', foot }) {
  return <div className="stat-card"><div className="stat-top"><span>{label}</span><span className={`stat-icon stat-${tone}`}><Icon size={18}/></span></div><div className="stat-value">{value}<small>{unit}</small></div><div className="stat-foot">{trend && <span className={trend.startsWith('+')?'trend-up':'trend-down'}>{trend.startsWith('+')?<ArrowUpRight size={13}/>:<ArrowDownRight size={13}/>} {trend}</span>}<span>{foot}</span></div></div>;
}
function Login({ onLogin }) {
  const [role,setRole]=useState('patient');
  const [email,setEmail]=useState('patient@cardioguard.demo');
  const [password,setPassword]=useState('cardio123');
  const [show,setShow]=useState(false);
  const [error,setError]=useState('');
  const [mode,setMode]=useState('signin');
  const [name,setName]=useState('');
  const submit=(e)=>{e.preventDefault();setError('');
    if(mode==='signup'){
      if(!name.trim()||!email.trim()||password.length<6){setError('Enter your name, email, and a password with at least 6 characters.');return;}
      onLogin({name:name.trim(),email,role});
      return;
    }
    const demo=role==='doctor'?DEMO_DOCTOR:DEMO_USER;
    if(email.toLowerCase()===demo.email&&password===demo.password) onLogin(demo);
    else setError('Those demo credentials did not match. Use the demo account details below.');
  };
  const chooseRole=(r)=>{setRole(r);setEmail(r==='doctor'?DEMO_DOCTOR.email:DEMO_USER.email);setPassword(r==='doctor'?DEMO_DOCTOR.password:DEMO_USER.password);setError('');};
  return <div className="auth-shell"><div className="auth-art"><div className="auth-art-grid"/><div className="auth-orbit orbit-one"/><div className="auth-orbit orbit-two"/><div className="auth-art-content"><Brand/><div className="auth-pulse"><HeartPulse size={88} strokeWidth={1.15}/><div className="pulse-ring"/></div><div className="auth-art-copy"><Badge tone="green" dot>EDGE AI MONITORING</Badge><h1>Every beat.<br/><span>More insight.</span></h1><p>Connected cardiac monitoring that turns ECG and oxygen signals into clearer clinical insights.</p></div><div className="auth-mini-stats"><div><span>01</span><strong>Capture</strong><small>Live ECG signals</small></div><div><span>02</span><strong>Understand</strong><small>AI-assisted insights</small></div><div><span>03</span><strong>Follow up</strong><small>Review records</small></div></div></div><div className="auth-footer">CARDIOGUARD · FINAL YEAR PROJECT</div></div>
  <div className="auth-panel"><div className="auth-mobile-brand"><Brand/></div><div className="auth-form-wrap"><div className="auth-welcome"><div className="eyebrow">YOUR HEALTH, IN FOCUS</div><h2>{mode==='signin'?'Welcome back':'Create demo access'}</h2><p>{mode==='signin'?'Sign in to open your monitoring workspace.':'Explore the CardioGuard patient or doctor experience.'}</p></div>
    <div className="role-switch"><button className={role==='patient'?'active':''} onClick={()=>chooseRole('patient')} type="button"><UserRound size={17}/> Patient</button><button className={role==='doctor'?'active':''} onClick={()=>chooseRole('doctor')} type="button"><Stethoscope size={17}/> Doctor</button></div>
    <form onSubmit={submit} className="auth-form">{mode==='signup'&&<label>Full name<div className="input-wrap"><UserRound size={17}/><input value={name} onChange={e=>setName(e.target.value)} placeholder="Your full name" required/></div></label>}
      <label>Email address<div className="input-wrap"><Mail size={17}/><input type="email" value={email} onChange={e=>setEmail(e.target.value)} required placeholder="you@example.com"/></div></label>
      <label>Password<div className="input-wrap"><LockKeyhole size={17}/><input type={show?'text':'password'} value={password} onChange={e=>setPassword(e.target.value)} required placeholder="Enter your password"/><button className="reveal-btn" type="button" onClick={()=>setShow(!show)} aria-label="Toggle password visibility">{show?<EyeOff size={17}/>:<Eye size={17}/>}</button></div></label>
      {error&&<div className="form-error"><AlertTriangle size={16}/>{error}</div>}
      <button className="btn btn-primary auth-submit" type="submit">{mode==='signin'?'Sign in to workspace':'Create demo session'}<ChevronRight size={17}/></button>
    </form>
    <div className="auth-switch">{mode==='signin'?"New to CardioGuard?":"Already have demo access?"} <button onClick={()=>{setMode(mode==='signin'?'signup':'signin');setError('');}}>{mode==='signin'?'Create demo access':'Sign in'}</button></div>
    <div className="demo-box"><div className="demo-box-title"><CircleHelp size={16}/> Demo credentials</div><div className="demo-credential"><span>Patient</span><button type="button" onClick={()=>chooseRole('patient')}>patient@cardioguard.demo <b>·</b> cardio123</button></div><div className="demo-credential"><span>Doctor</span><button type="button" onClick={()=>chooseRole('doctor')}>doctor@cardioguard.demo <b>·</b> doctor123</button></div></div>
    <div className="auth-security"><ShieldCheck size={15}/> Demo interface · Do not enter real patient information</div>
  </div></div></div>;
}

function Shell({ user, onLogout, children, deviceOnline, records = [], capture }) {
  const [drawer,setDrawer]=useState(false);
  const [profileOpen,setProfileOpen]=useState(false);
  const location=useLocation();
  useEffect(()=>{setDrawer(false);setProfileOpen(false)},[location.pathname]);
  useEffect(()=>{const close=(event)=>{if(!event.target.closest('.profile-menu-wrap'))setProfileOpen(false)};document.addEventListener('click',close);return()=>document.removeEventListener('click',close)},[]);
  const links=[{to:'/home',label:'Overview',icon:LayoutDashboard},{to:'/analysis',label:'Patient records',icon:ClipboardList},{to:'/local-train',label:'Local training',icon:BrainCircuit},{to:'/aggregate-weights',label:'Federated learning',icon:Network}];
  return <div className="app-shell"><aside className={`sidebar ${drawer?'sidebar-open':''}`}><div className="sidebar-head"><Brand/><button className="icon-btn sidebar-close" onClick={()=>setDrawer(false)}><X size={18}/></button></div><div className="workspace-label">WORKSPACE</div><nav className="side-nav">{links.map(l=><NavLink key={l.to} to={l.to} className={({isActive})=>`nav-link ${isActive?'nav-active':''}`}><l.icon size={18}/><span>{l.label}</span>{l.to==='/analysis'&&<span className="nav-count">Live</span>}</NavLink>)}</nav><div className="sidebar-spacer"/><div className="device-mini"><div className="device-mini-top"><span className={`status-dot ${deviceOnline?'online':'offline'}`}/><span>EDGE DEVICE</span><MoreHorizontal size={17}/></div><strong>{deviceOnline?'Device connected':'Device offline'}</strong><small>{deviceOnline?'Ready to capture signals':'Check network connection'}</small><div className="device-mini-bottom"><span><span className={`tiny-dot ${deviceOnline?'online':'offline'}`}/>{deviceOnline?'Online':'Offline'}</span><span>Raspberry Pi</span></div></div><div className="sidebar-user"><div className="avatar">{user.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}</div><div className="sidebar-user-copy"><strong>{user.name}</strong><small>{user.role==='doctor'?'Clinical workspace':'Patient workspace'}</small></div><button className="icon-btn logout-btn" onClick={onLogout} title="Sign out"><LogOut size={17}/></button></div></aside>
    {drawer&&<div className="drawer-scrim" onClick={()=>setDrawer(false)}/>}<main className="main-area"><header className="topbar"><div className="topbar-left"><button className="icon-btn menu-toggle" onClick={()=>setDrawer(true)}><Menu size={20}/></button><div className="crumb"><span>Workspace</span><ChevronRight size={14}/><strong>{links.find(l=>location.pathname.startsWith(l.to))?.label || (location.pathname.includes('/analysis/')?'Record details':'Overview')}</strong></div></div><div className="topbar-right"><div className={`top-status ${deviceOnline?'':'top-status-offline'}`}><span className={`tiny-dot ${deviceOnline?'online':'offline'}`}/>{deviceOnline?'Edge connected':'Edge offline'}</div><button className="icon-btn notification-btn" title="Notifications"><Bell size={18}/><i/></button><div className="profile-menu-wrap"><button className={`topbar-avatar profile-trigger ${profileOpen?'profile-trigger-open':''}`} onClick={()=>setProfileOpen(v=>!v)} aria-label="Open profile information" aria-expanded={profileOpen}>{user.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}</button>{profileOpen&&<div className="profile-popover"><div className="profile-popover-head"><div className="profile-avatar-large">{user.name.split(' ').map(x=>x[0]).join('').slice(0,2).toUpperCase()}</div><div><strong>{user.name}</strong><span>{user.role==='doctor'?'Doctor account':'Patient account'}</span></div><button className="profile-close" onClick={()=>setProfileOpen(false)} aria-label="Close profile"><X size={15}/></button></div><div className="profile-role-line"><ShieldCheck size={14}/><span>{user.role==='doctor'?'Clinical workspace':'Personal health workspace'}</span><Badge tone={user.role==='doctor'?'blue':'green'}>{user.role==='doctor'?'DOCTOR':'PATIENT'}</Badge></div><div className="profile-details"><div><span>Email address</span><strong>{user.email||'Not provided'}</strong></div><div><span>Account name</span><strong>{user.name}</strong></div>{user.role==='patient'?<><div><span>Patient reference</span><strong>CG-P-0001 <small className="demo-inline">DEMO</small></strong></div><div><span>Monitoring device</span><strong>Raspberry Pi edge device</strong></div><div><span>Saved records</span><strong>{records.length}</strong></div><div><span>Latest model output</span><strong>{LABELS[capture?.prediction]?.name||'No capture yet'}</strong></div></>:<><div><span>Workspace</span><strong>Clinical review & records</strong></div><div><span>Records available</span><strong>{records.length}</strong></div><div><span>Awaiting review</span><strong>{records.filter(r=>r.true_label===-1).length}</strong></div><div className="profile-notice"><AlertTriangle size={14}/><span>Patient details shown here are limited to data returned by this demo frontend. No separate patient-profile API is configured.</span></div></>}</div><div className="profile-popover-foot"><span><LockKeyhole size={13}/> Demo profile · not verified identity</span><button onClick={onLogout}><LogOut size={14}/> Sign out</button></div></div>}</div></div></header><div className="content-area">{children}</div><footer className="app-footer"><span>© 2026 CardioGuard · Edge AI cardiac monitoring</span><span><ShieldCheck size={13}/> Informational display only · Not a diagnosis</span></footer></main></div>;
}

function Overview({ user, deviceOnline, capture, setCapture, onCapture, busy, records, refreshRecords }) {
  const latestSpo=validSpo2(capture?.oxygen_info);
  const spo=latestSpo.length?latestSpo.reduce((a,b)=>a+b,0)/latestSpo.length:97;
  const ecg=capture?.ecg_info?.flat() || makeWave();
  const pred=LABELS[capture?.prediction] || LABELS[1];
  const [tick,setTick]=useState(0);
  useEffect(()=>{const t=setInterval(()=>setTick(v=>v+1),1000);return()=>clearInterval(t)},[]);
  return <><PageHeader eyebrow="MONITORING OVERVIEW" title={`Good ${new Date().getHours()<12?'morning':new Date().getHours()<18?'afternoon':'evening'}, ${user.name.split(' ')[0]}.`} subtitle="Here's a clear view of your cardiac monitoring workspace." action={<Button variant="secondary" icon={RefreshCw} onClick={refreshRecords}>Refresh data</Button>}/>
    {!deviceOnline&&<div className="alert-banner"><div className="alert-icon"><WifiOff size={19}/></div><div><strong>Edge device is offline</strong><p>We couldn't reach the monitoring device. Check its power and network connection, then retry.</p></div><Button variant="secondary" size="small" icon={RefreshCw} onClick={()=>window.dispatchEvent(new Event('cg-health-check'))}>Retry</Button></div>}
    <div className="welcome-strip"><div className="welcome-strip-icon"><Activity size={21}/></div><div><strong>{user.role==='doctor'?'Clinical overview':'Your monitoring overview'}</strong><span>{user.role==='doctor'?'Review recent captures and support clinician-labelled records.':'Your recent signal capture and monitoring status, all in one place.'}</span></div><div className="welcome-strip-meta"><span className={`status-dot ${deviceOnline?'online':'offline'}`}/>{deviceOnline?'System ready':'Connection needed'}</div></div>
    <div className="stats-grid"><StatCard label="Latest SpO₂" value={Math.round(spo)} unit="%" icon={Waves} trend="+0.8%" tone="teal" foot="Mean of valid samples"/><StatCard label="ECG windows" value={capture?.ecg_info?.length||1} unit="" icon={Activity} tone="violet" foot="180 samples per window"/><StatCard label="Saved records" value={records.length} unit="" icon={FileHeart} tone="blue" foot="On this edge device"/><StatCard label="Device status" value={deviceOnline?'Online':'Offline'} unit="" icon={Wifi} tone={deviceOnline?'green':'red'} foot={deviceOnline?'Ready for capture':'Check connection'}/></div>
    <div className="dashboard-grid"><section className="panel live-panel"><div className="panel-head"><div><div className="panel-kicker"><span className="live-pulse"/> LIVE SIGNAL</div><h3>ECG waveform</h3><p>Electrical activity · captured signal</p></div><Badge tone="green" dot>{busy?'Capturing':'Signal preview'}</Badge></div><div className="ecg-meta"><span><i className="legend-dot teal-dot"/> ECG signal</span><span>Window 01 <b>·</b> 180 samples</span></div><div className="ecg-frame"><ECGLine data={ecg} id="overview-ecg" height={160} fill/></div><div className="signal-footer"><div><span>Capture state</span><strong>{busy?'Processing signal':'Ready to capture'}</strong></div><div><span>Sampling</span><strong>Live edge stream</strong></div><div><span>Updated</span><strong>{tick%60}s ago</strong></div></div><div className="panel-action-row"><span className="subtle-note"><ShieldCheck size={14}/> ECG signal visualisation</span><Button onClick={onCapture} disabled={busy||!deviceOnline} icon={busy?LoaderCircle:Play}>{busy?'Capturing…':'Start new capture'}</Button></div></section>
      <section className="panel oxygen-panel"><div className="panel-head"><div><div className="panel-kicker">OXYGEN SATURATION</div><h3>Blood oxygen</h3><p>Pulse-ox sensor · raw SpO₂ readings</p></div><span className="panel-icon"><Waves size={18}/></span></div><GaugeChart value={spo}/><div className="oxygen-stats"><div><span>Minimum</span><strong>{latestSpo.length?Math.min(...latestSpo).toFixed(1):'—'}<small>%</small></strong></div><div><span>Maximum</span><strong>{latestSpo.length?Math.max(...latestSpo).toFixed(1):'—'}<small>%</small></strong></div><div><span>Valid samples</span><strong>{latestSpo.length}<small>/180</small></strong></div></div><div className="chart-mini"><div className="chart-mini-head"><span>Recent trend</span><Badge tone={spo>=95?'green':spo>=90?'amber':'red'}>{spo>=95?'Stable range':spo>=90?'Monitor':'Low reading'}</Badge></div><Sparkline data={latestSpo.slice(0,70)} color={spo>=95?'#43d9a4':spo>=90?'#f3b65b':'#ff6d78'}/></div><p className="micro-disclaimer">Display aid only, not a diagnosis. Invalid/dropout sensor values are excluded.</p></section>
    </div>
    <div className="lower-grid"><section className="panel prediction-panel"><div className="panel-head"><div><div className="panel-kicker">MODEL OUTPUT</div><h3>Latest AI prediction</h3></div><Sparkles size={19} className="muted-icon"/></div><div className="prediction-content"><div className={`prediction-symbol prediction-${pred.tone}`}><HeartPulse size={25}/></div><div className="prediction-copy"><div className="prediction-name">{pred.name}</div><div className="prediction-sub">Label code <strong>{pred.code}</strong> · First ECG window only</div></div><Badge tone={pred.tone}>{pred.code}</Badge></div><div className="prediction-foot"><span>Record #{capture?.id||'—'}</span><NavLink to={`/analysis/${capture?.id||'latest'}`}>View capture <ArrowUpRight size={14}/></NavLink></div></section>
      <section className="panel recent-panel"><div className="panel-head"><div><div className="panel-kicker">RECENT ACTIVITY</div><h3>Recent records</h3></div><NavLink to="/analysis" className="text-link">View all <ChevronRight size={15}/></NavLink></div>{records.length?records.slice(0,3).map(r=><RecordRow key={r.id} record={r}/>):<div className="empty-inline"><div className="empty-icon"><ClipboardList size={20}/></div><div><strong>No saved records yet</strong><span>Start a capture to create your first record.</span></div></div>}</section></div>
  </>;
}
function RecordRow({record}) {
 const label=LABELS[record.prediction]||LABELS[1];
 return <NavLink className="record-row" to={`/analysis/${record.id}`}><div className="record-wave"><Activity size={17}/></div><div className="record-main"><strong>Record #{record.id}</strong><span>{record.ecg_info?.length||0} ECG windows · Device {record.device_id??'—'}</span></div><Badge tone={record.true_label===-1?'amber':label.tone}>{record.true_label===-1?'Unlabelled':label.code}</Badge><ChevronRight size={16} className="record-chevron"/></NavLink>;
}
function Analysis({ records, loading, error, onRefresh }) {
 const [search,setSearch]=useState('');
 const [filter,setFilter]=useState('all');
 const filtered=records.filter(r=>{
   const q=search.toLowerCase();
   const label=LABELS[r.prediction]||LABELS[1];
   return (`${r.id} ${r.device_id} ${label.name} ${label.code}`).toLowerCase().includes(q) && (filter==='all'||(filter==='unlabelled'?r.true_label===-1:r.true_label!==-1));
 });
 return <><PageHeader eyebrow="RECORD LIBRARY" title="Patient records" subtitle="Explore saved ECG captures, AI predictions, and clinician labels." action={<Button variant="secondary" icon={RefreshCw} onClick={onRefresh}>Refresh records</Button>}/>
 <div className="record-summary-grid"><div className="record-summary"><span>Total records</span><strong>{records.length}</strong><small>Stored on edge device</small></div><div className="record-summary"><span>Awaiting review</span><strong>{records.filter(r=>r.true_label===-1).length}</strong><small>Need a true label</small></div><div className="record-summary"><span>Clinician labelled</span><strong>{records.filter(r=>r.true_label!==-1).length}</strong><small>Reviewed records</small></div></div>
 <section className="panel table-panel"><div className="table-toolbar"><div><h3>All captures</h3><p>Records are sorted by record ID, newest first.</p></div><div className="table-filters"><div className="search-box"><Search size={16}/><input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search record ID…"/></div><select value={filter} onChange={e=>setFilter(e.target.value)}><option value="all">All records</option><option value="unlabelled">Unlabelled</option><option value="labelled">Labelled</option></select></div></div>
 {error&&<div className="inline-error"><AlertTriangle size={16}/>{error}</div>}
 {loading?<div className="loading-state"><LoaderCircle className="spin" size={24}/> Loading records…</div>:filtered.length?<div className="table-scroll"><table><thead><tr><th>RECORD</th><th>AI PREDICTION</th><th>TRUE LABEL</th><th>ECG WINDOWS</th><th>DEVICE</th><th></th></tr></thead><tbody>{filtered.map(r=>{const l=LABELS[r.prediction]||LABELS[1];const trueLabel=LABELS[r.true_label];return <tr key={r.id}><td><NavLink className="table-record" to={`/analysis/${r.id}`}><span className="table-record-icon"><Activity size={16}/></span><span><strong>Record #{r.id}</strong><small>Saved capture</small></span></NavLink></td><td><Badge tone={l.tone}>{l.code} · {l.name}</Badge></td><td>{r.true_label===-1?<Badge tone="amber">Unlabelled</Badge>:<Badge tone="green">{trueLabel?.code||r.true_label}</Badge>}</td><td>{r.ecg_info?.length||0} windows</td><td>Device {r.device_id??'—'}</td><td><NavLink to={`/analysis/${r.id}`} className="table-open">Open <ChevronRight size={14}/></NavLink></td></tr>})}</tbody></table></div>:<div className="empty-state"><div className="empty-icon"><ClipboardList size={25}/></div><h3>{records.length?'No matching records':'No records to show'}</h3><p>{records.length?'Try a different search or filter.':'When a capture is saved on the edge device, it will appear here.'}</p><Button variant="secondary" onClick={onRefresh} icon={RefreshCw}>Try again</Button></div>}
 <div className="table-foot"><span>Showing {filtered.length} of {records.length} records</span><span>Edge device data · no date field supplied by API</span></div></section></>;
}
function RecordDetail({ records, user, onRecordsChange }) {
 const {id}=useParams();const navigate=useNavigate();
 const record=records.find(r=>String(r.id)===String(id)) || (String(id)==='latest'?initialCapture:null);
 const [label,setLabel]=useState(record?.true_label>=0?String(record.true_label):'');
 const [saving,setSaving]=useState(false);const [message,setMessage]=useState('');const [error,setError]=useState('');
 useEffect(()=>{setLabel(record?.true_label>=0?String(record.true_label):'');setMessage('');setError('')},[id,record?.true_label]);
 if(!record)return <><PageHeader eyebrow="RECORD DETAILS" title="Record not found" subtitle="This record is not in the currently loaded edge-device data."/><div className="panel empty-state"><div className="empty-icon"><Search size={24}/></div><h3>Could not find record #{id}</h3><p>Refresh the records list or return to the library.</p><Button onClick={()=>navigate('/analysis')}>Back to records</Button></div></>;
 const pred=LABELS[record.prediction]||LABELS[1];const spo=validSpo2(record.oxygen_info);const avg=spo.length?spo.reduce((a,b)=>a+b,0)/spo.length:null;const ecg=record.ecg_info?.flat()||[];
 const save=async()=>{if(label===''||!LABELS[Number(label)]){setError('Choose a valid label before saving.');return;}setSaving(true);setError('');setMessage('');try{await api.label(record.id,Number(label));setMessage(`True label saved for record #${record.id}.`);onRecordsChange(record.id,Number(label));}catch(e){setError(e.message||'Could not save the label. Try again.');}finally{setSaving(false)}};
 return <><div className="back-link-wrap"><button className="back-link" onClick={()=>navigate('/analysis')}>← Back to records</button></div><PageHeader eyebrow={`RECORD #${record.id}`} title="Capture details" subtitle="Inspect the ECG signal, oxygen samples, and model output." action={<Badge tone={record.true_label===-1?'amber':'green'} dot>{record.true_label===-1?'Awaiting clinician review':'Clinician labelled'}</Badge>}/>
 <div className="detail-metrics"><div><span>AI prediction</span><strong>{pred.code} · {pred.name}</strong></div><div><span>Device ID</span><strong>{record.device_id??'—'}</strong></div><div><span>ECG windows</span><strong>{record.ecg_info?.length||0}</strong></div><div><span>Mean SpO₂</span><strong>{avg===null?'Sensor not detected':`${avg.toFixed(1)}%`}</strong></div></div>
 <div className="detail-grid"><section className="panel detail-signal"><div className="panel-head"><div><div className="panel-kicker">SIGNAL INSPECTION</div><h3>ECG waveform</h3><p>All available windows · concatenated view</p></div><Badge tone="neutral">{ecg.length} samples</Badge></div><div className="ecg-frame detail-ecg"><ECGLine data={ecg.length?ecg:makeWave()} id="detail-ecg" height={220} fill/></div><div className="window-list"><span>WINDOW SELECTOR</span>{(record.ecg_info||[]).map((w,i)=><button key={i} className="window-chip" onClick={()=>document.getElementById(`window-${i}`)?.scrollIntoView({behavior:'smooth',block:'center'})}>Window {String(i+1).padStart(2,'0')}</button>)}</div>{(record.ecg_info||[]).map((w,i)=><div className="individual-window" id={`window-${i}`} key={i}><div><strong>Window {String(i+1).padStart(2,'0')}</strong><span>{w.length} samples</span></div><ECGLine data={w} id={`win-${i}`} height={75}/></div>)}</section>
 <section className="panel detail-oxygen"><div className="panel-head"><div><div className="panel-kicker">PULSE OXIMETRY</div><h3>Oxygen readings</h3><p>Raw SpO₂ percentage · cleaned values</p></div></div>{avg===null?<div className="sensor-empty"><Waves size={25}/><strong>Pulse-ox sensor not detected</strong><span>No valid samples between 50% and 100% were found.</span></div>:<><GaugeChart value={avg}/><div className="oxygen-stats"><div><span>Minimum</span><strong>{Math.min(...spo).toFixed(1)}<small>%</small></strong></div><div><span>Maximum</span><strong>{Math.max(...spo).toFixed(1)}<small>%</small></strong></div><div><span>Samples</span><strong>{spo.length}</strong></div></div><Sparkline data={spo} /></>}<div className="medical-note"><AlertTriangle size={15}/><span>Display bands are informational only and are not a diagnosis.</span></div><div className="heart-rate-placeholder"><HeartPulse size={19}/><div><strong>Heart rate</strong><span>Unavailable until sampling rate and R-peak detection are configured.</span></div></div></section></div>
 <section className="panel label-panel"><div className="label-panel-copy"><div className="panel-kicker">CLINICIAN REVIEW</div><h3>AI prediction vs. true label</h3><p>The model predicts the first ECG window only. A clinician can assign a ground-truth label to support future training.</p><div className="label-comparison"><div><span>Model prediction</span><strong>{pred.code} — {pred.name}</strong></div><div><span>Saved true label</span><strong>{record.true_label===-1?'Not labelled':`${LABELS[record.true_label]?.code||record.true_label} — ${LABELS[record.true_label]?.name||'Labelled'}`}</strong></div></div></div>
 {user.role==='doctor'?<div className="label-form"><label htmlFor="true-label">Add true label</label><select id="true-label" value={label} onChange={e=>setLabel(e.target.value)}><option value="">Choose a label…</option>{Object.entries(LABELS).map(([k,v])=><option key={k} value={k}>{v.code} — {v.name}</option>)}</select><Button onClick={save} disabled={saving||label===''} icon={saving?LoaderCircle:Check}>{saving?'Saving…':'Save true label'}</Button>{error&&<div className="form-error"><AlertTriangle size={14}/>{error}</div>}{message&&<div className="form-success"><CircleCheck size={14}/>{message}</div>}</div>:<div className="doctor-only-note"><LockKeyhole size={17}/><div><strong>Doctor review</strong><span>Sign in with a doctor demo account to label records in this interface.</span></div></div>}</section></>;
}
function Training({ deviceOnline }) {
 const [loading,setLoading]=useState(false);const [result,setResult]=useState(null);const [error,setError]=useState('');
 const run=async()=>{setLoading(true);setError('');setResult(null);try{setResult(await api.train())}catch(e){setError(e.message||'Local training failed.')}finally{setLoading(false)}};
 return <><PageHeader eyebrow="ON-DEVICE LEARNING" title="Local model training" subtitle="Train the model on labelled windows stored by this edge device."/><div className="feature-hero training-hero"><div className="feature-hero-copy"><Badge tone="violet" dot>EDGE COMPUTING</Badge><h2>Learning, close to the signal.</h2><p>Run local training on the edge device, reducing the need to move raw physiological data off-device.</p><div className="feature-points"><span><Check size={15}/> Uses local labelled windows</span><span><Check size={15}/> Reports loss and accuracy</span><span><Check size={15}/> Results from the device API</span></div><Button onClick={run} disabled={loading||!deviceOnline} icon={loading?LoaderCircle:Play}>{loading?'Training in progress…':'Start local training'}</Button>{!deviceOnline&&<small className="button-hint">Connect the edge device to begin.</small>}</div><div className="neural-visual"><div className={`neural-core ${loading?'neural-active':''}`}><BrainCircuit size={56}/></div>{Array.from({length:8},(_,i)=><i key={i} className={`neural-node node-${i+1}`}/>)}<div className="neural-caption">{loading?'OPTIMISING MODEL':'LOCAL MODEL'}</div></div></div>
 {loading&&<div className="progress-panel"><div className="progress-heading"><LoaderCircle className="spin" size={17}/><strong>Training on the edge device</strong><span>This can take seconds to minutes.</span></div><div className="progress-track"><i/></div><p>Keep this page open while the device runs its training process.</p></div>}
 {error&&<div className="error-card"><AlertTriangle size={20}/><div><strong>Training could not complete</strong><p>{error}</p><small>Tip: label more records first. The API may require at least 32 labelled windows.</small><Button variant="secondary" size="small" onClick={run} icon={RefreshCw}>Try again</Button></div></div>}
 {result&&<div className="result-section"><div className="section-heading"><div><div className="eyebrow">TRAINING COMPLETE</div><h2>Training results</h2></div><Badge tone="green" dot>Success</Badge></div><div className="training-results"><div className="result-stat"><span>Training windows</span><strong>{result.num_windows??'—'}</strong><small>Used in this run</small></div><div className="result-stat"><span>Loss</span><strong>{result.loss??'—'}</strong><small>Lower is generally better</small></div><div className="result-stat"><span>Accuracy</span><strong>{result.accuracy==null?'—':`${(Number(result.accuracy)*100).toFixed(1)}%`}</strong><small>Device-reported metric</small></div></div><div className="success-banner"><CircleCheck size={18}/>{result.message||'Local training completed.'}</div></div>}
 <div className="info-card"><div className="info-icon"><CircleHelp size={19}/></div><div><strong>Before you train</strong><p>The backend may return a 400 error if there are not enough labelled windows. Review records and add true labels first, then run training again.</p><NavLink to="/analysis" className="text-link">Review patient records <ArrowUpRight size={14}/></NavLink></div></div></>;
}
function Aggregate({ deviceOnline }) {
 const [loading,setLoading]=useState(false);const [result,setResult]=useState(null);const [error,setError]=useState('');
 const run=async()=>{setLoading(true);setError('');setResult(null);try{setResult(await api.aggregate())}catch(e){setError(e.message||'Could not aggregate weights.')}finally{setLoading(false)}};
 return <><PageHeader eyebrow="FEDERATED LEARNING" title="Aggregate model weights" subtitle="Coordinate global model updates across participating edge devices."/><div className="feature-hero aggregate-hero"><div className="feature-hero-copy"><Badge tone="blue" dot>COLLABORATIVE LEARNING</Badge><h2>Share learning.<br/>Not raw signals.</h2><p>Send local model updates to the server and apply the next global model when enough participating devices are ready.</p><div className="feature-points"><span><Check size={15}/> Local training happens on-device</span><span><Check size={15}/> Global aggregation is server-coordinated</span><span><Check size={15}/> Status comes from the edge API</span></div><Button onClick={run} disabled={loading||!deviceOnline} icon={loading?LoaderCircle:Network}>{loading?'Syncing weights…':'Send weights to server'}</Button>{!deviceOnline&&<small className="button-hint">Connect the edge device to continue.</small>}</div><div className={`federated-visual ${loading?'federated-active':''}`}><div className="federated-ring ring-a"/><div className="federated-ring ring-b"/><div className="federated-center"><Network size={36}/><span>GLOBAL<br/>MODEL</span></div>{Array.from({length:5},(_,i)=><div className={`federated-device fd-${i+1}`} key={i}><Activity size={16}/></div>)}</div></div>
 {loading&&<div className="progress-panel"><div className="progress-heading"><LoaderCircle className="spin" size={17}/><strong>Syncing with global model</strong><span>Waiting for other edge devices may take up to 120 seconds.</span></div><div className="progress-track"><i/></div><p>Please keep the page open while the server coordinates model updates.</p></div>}
 {error&&<div className="error-card"><AlertTriangle size={20}/><div><strong>Aggregation did not complete</strong><p>{error}</p><small>If the global model is not ready yet, other devices may still need to submit their weights.</small><Button variant="secondary" size="small" onClick={run} icon={RefreshCw}>Try again</Button></div></div>}
 {result&&<div className="success-result"><div className="success-result-icon"><Check size={22}/></div><div><Badge tone="green">UPDATE APPLIED</Badge><h3>{result.message||'Global weights applied.'}</h3><p>Federated aggregation has returned a successful response from the edge device.</p><div className="round-stat"><span>Global round</span><strong>{result.round??'—'}</strong></div></div></div>}
 <div className="federated-steps"><div className="section-heading"><div><div className="eyebrow">HOW IT WORKS</div><h2>From local to global</h2></div></div><div className="steps-grid"><div><span className="step-num">01</span><BrainCircuit size={22}/><strong>Train locally</strong><p>Each device learns from its own labelled signal windows.</p></div><div><span className="step-num">02</span><Network size={22}/><strong>Aggregate updates</strong><p>The server combines submitted model weights.</p></div><div><span className="step-num">03</span><Zap size={22}/><strong>Apply global model</strong><p>Participating devices can use the updated model in future inference.</p></div></div></div></>;
}

export default function App() {
 const [user,setUser]=useState(getSavedUser);
 const [deviceOnline,setDeviceOnline]=useState(false);
 const [healthChecked,setHealthChecked]=useState(false);
 const [capture,setCapture]=useState(initialCapture);
 const [busy,setBusy]=useState(false);
 const [records,setRecords]=useState([]);
 const [recordsLoading,setRecordsLoading]=useState(false);
 const [recordsError,setRecordsError]=useState('');
 const navigate=useNavigate();
 const login=(u)=>{sessionStorage.setItem('cg_user',JSON.stringify(u));setUser(u);navigate('/home')};
 const logout=()=>{sessionStorage.removeItem('cg_user');setUser(null);navigate('/')};
 const checkHealth=useCallback(async()=>{try{await api.health();setDeviceOnline(true)}catch{setDeviceOnline(false)}finally{setHealthChecked(true)}},[]);
 const refreshRecords=useCallback(async()=>{if(!user)return;setRecordsLoading(true);setRecordsError('');try{const data=await api.records();setRecords(asRecords(data).sort((a,b)=>Number(b.id)-Number(a.id)))}catch(e){setRecordsError(e.message||'Could not load records.');setRecords([])}finally{setRecordsLoading(false)}},[user]);
 useEffect(()=>{checkHealth();const t=setInterval(checkHealth,10000);const h=()=>checkHealth();window.addEventListener('cg-health-check',h);return()=>{clearInterval(t);window.removeEventListener('cg-health-check',h)}},[checkHealth]);
 useEffect(()=>{if(user){refreshRecords()}},[user,refreshRecords]);
 const onCapture=async()=>{setBusy(true);setCapture(null);try{const result=await api.predict();setCapture(result);await refreshRecords();navigate(`/analysis/${result.id}`)}catch(e){setCapture(initialCapture);alert(e.message||'Capture failed. Check electrode and cable connections, then retry.')}finally{setBusy(false)}};
 const updateLabel=(id,label)=>setRecords(prev=>prev.map(r=>r.id===id?{...r,true_label:label}:r));
 if(!user)return <Login onLogin={login}/>;
 return <Shell user={user} onLogout={logout} deviceOnline={deviceOnline} records={records} capture={capture||initialCapture}><Routes>
   <Route path="/" element={<Navigate to="/home" replace/>}/>
   <Route path="/home" element={<Overview user={user} deviceOnline={deviceOnline} capture={capture||initialCapture} setCapture={setCapture} onCapture={onCapture} busy={busy} records={records} refreshRecords={refreshRecords}/>}/>
   <Route path="/analysis" element={<Analysis records={records} loading={recordsLoading} error={recordsError} onRefresh={refreshRecords}/>}/>
   <Route path="/analysis/:id" element={<RecordDetail records={records} user={user} onRecordsChange={updateLabel}/>}/>
   <Route path="/local-train" element={<Training deviceOnline={deviceOnline}/>}/>
   <Route path="/aggregate-weights" element={<Aggregate deviceOnline={deviceOnline}/>}/>
   <Route path="*" element={<Navigate to="/home" replace/>}/>
 </Routes></Shell>;
}