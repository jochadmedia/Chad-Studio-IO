import { useState, useRef, useEffect } from "react";
import { uploadAvatar } from "./supabase";

const C = {
  bg:"#080808", bg2:"#0f0f0f", bg3:"#141414", bg4:"#1a1a1a",
  border:"#1e1e1e", border2:"#2a2a2a",
  gold:"#d4a843", goldBright:"#f0c040",
  text:"#e8e4dc", text2:"#8a8680", text3:"#444440",
  green:"#00e676", greenDim:"#0a2018",
  red:"#ff3d3d", blue:"#4da6ff",
};
const mono = "'Courier New', Courier, monospace";
const fmtSize = b => b<1024*1024?`${(b/1024).toFixed(0)} KB`:`${(b/(1024*1024)).toFixed(1)} MB`;
const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(Math.floor(s%60)).padStart(2,"0")}`;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

const PERF_TYPES  = ["RAPPING","SINGING","SPEECH","FREESTYLE"];
const SCENE_TAGS  = ["ROOFTOP","CITY STREET","STUDIO","TOKYO","PARIS","DESERT","CONCERT HALL","WAREHOUSE"];
const CAMERAS     = ["SLOW ORBIT...","CLOSE-UP","BIRD SHOT","MEDIUM","ORBIT 360°","SLOW DOLLY","HANDHELD","DOLLY ZOOM","RED CAMERA","SLOW MO"];
const STYLES      = ["RED CAMERA...","ANAMORPHIC","FILM GRAIN","4K HDR","NEON LIT","GOLDEN HOUR"];
const DURATIONS   = ["4s","6s","8s"];
const SCREENS     = ["GENERATOR","ADVANCED STUDIO"];

const PIPELINE_STAGES = [
  { id:"ingest",     icon:"📁", name:"ASSET INGEST",    model:"Local → Memory"   },
  { id:"transcribe", icon:"🎙", name:"AUDIO TRANSCRIBE",model:"gemini-2.5-flash"    },
  { id:"prompt",     icon:"🧠", name:"PROMPT BUILD",     model:"gemini-2.5-flash"    },
  { id:"generate",   icon:"🎬", name:"VIDEO GENERATE",   model:"veo-3.1-fast-001"    },
  { id:"sync",       icon:"🔄", name:"SYNC ANALYSIS",    model:"gemini-2.5-flash"    },
  { id:"broll",      icon:"🎥", name:"B-ROLL GENERATE",  model:"veo-3.1-fast-001"    },
  { id:"compose",    icon:"🎞", name:"COMPOSE",          model:"Merge + Grade"   },
  { id:"ready",      icon:"✅", name:"READY",            model:"Studio Unlock"   },
];

// ── API ───────────────────────────────────────────────────────
async function callGemini(apiKey, prompt, b64, mime) {
  const parts = [];
  if (b64) parts.push({ inline_data:{ mime_type:mime, data:b64 } });
  parts.push({ text:prompt });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    { method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({ contents:[{ parts }] }) }
  );
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||`Gemini ${res.status}`); }
  const d = await res.json();
  return d?.candidates?.[0]?.content?.parts?.[0]?.text||"";
}
async function startVeo(apiKey, prompt, imgB64, imgMime, durationSeconds=8) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-001:predictLongRunning?key=${apiKey}`,
    { method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ contents:[{ role:"user", parts:[{ inline_data:{ mime_type:imgMime, data:imgB64 } },{ text:prompt }] }],
        generationConfig:{ mediaResolution:"MEDIA_RESOLUTION_MEDIUM", aspectRatio:"9:16", durationSeconds, personGeneration:"allow_adult" } }) }
  );
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||`Veo ${res.status}`); }
  const d = await res.json();
  if (!d.name) throw new Error("No operation name from Veo.");
  return d.name;
}
async function pollVeo(apiKey, opName, onPoll) {
  for (let i=0;i<80;i++) {
    await sleep(5000); onPoll(i+1);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${opName}?key=${apiKey}`);
    if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||`Poll ${res.status}`); }
    const d = await res.json();
    if (d.done) {
      if (d.error) throw new Error(d.error.message||"Veo failed.");
      const s = (d.response?.generatedSamples||d.response?.videos||[])[0];
      const uri = s?.video?.uri||s?.videoUri||s?.uri;
      if (!uri) throw new Error("No video URI in response.");
      return uri;
    }
  }
  throw new Error("Veo timed out after ~6 min.");
}
function readB64(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result.split(",")[1]); r.onerror=()=>rej(new Error("read failed")); r.readAsDataURL(file); });
}
function readDataUrl(file) {
  return new Promise((res,rej)=>{ const r=new FileReader(); r.onload=()=>res(r.result); r.onerror=()=>rej(new Error("read failed")); r.readAsDataURL(file); });
}

// ── Shared UI ─────────────────────────────────────────────────
function StatusBar({ apiKey, onChangeKey }) {
  return (
    <div style={{ padding:"0 16px", height:"36px", background:apiKey.length>10?C.greenDim:C.bg2, borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
      <div style={{ fontFamily:mono, fontSize:"0.52rem", color:apiKey.length>10?C.green:C.text3, letterSpacing:"0.5px" }}>
        {apiKey.length>10
          ? "✓ GOOGLE AI STUDIO CONNECTED — GEMINI 2.5 FLASH · VEO 3.1 FAST · NANO BANANA 2 READY"
          : "ENTER YOUR GOOGLE AI STUDIO API KEY TO CONNECT"}
      </div>
      <button onClick={onChangeKey} style={{ fontFamily:mono, fontSize:"0.5rem", color:C.gold, border:`1px solid ${C.gold}`, background:"transparent", padding:"3px 10px", cursor:"pointer", letterSpacing:"1px" }}>
        CHANGE KEY
      </button>
    </div>
  );
}

function UploadZone({ icon, title, hint, accept, file, dataUrl, onFile, showImg }) {
  const ref = useRef();
  const [drag,setDrag] = useState(false);
  const handle = async f => { if(!f)return; const du=await readDataUrl(f); onFile(f,du); };
  return (
    <div onClick={()=>ref.current?.click()}
      onDragOver={e=>{e.preventDefault();setDrag(true);}} onDragLeave={()=>setDrag(false)}
      onDrop={e=>{e.preventDefault();setDrag(false);handle(e.dataTransfer.files[0]);}}
      style={{ border:`1px dashed ${drag?C.gold:file?C.green:C.border2}`, borderRadius:"3px", padding:"16px 12px",
        background:drag?"rgba(212,168,67,0.05)":file?"rgba(0,230,118,0.04)":C.bg3,
        cursor:"pointer", textAlign:"center", transition:"all 0.15s", display:"flex", flexDirection:"column", alignItems:"center", gap:"8px" }}>
      <input ref={ref} type="file" accept={accept} style={{display:"none"}} onChange={e=>handle(e.target.files[0])}/>
      {showImg && dataUrl
        ? <img src={dataUrl} alt="" style={{width:"60px",height:"60px",objectFit:"cover",borderRadius:"3px",border:`1px solid ${C.green}`}}/>
        : <div style={{fontSize:"1.8rem",opacity:file?1:0.4}}>{file?(file.type?.startsWith("image/")?"🖼":"🎵"):icon}</div>
      }
      {file
        ? <><div style={{fontFamily:mono,fontSize:"0.6rem",fontWeight:"700",color:C.green}}>✓ {file.name.length>26?file.name.slice(0,23)+"…":file.name}</div>
            <div style={{fontFamily:mono,fontSize:"0.5rem",color:C.text3}}>{fmtSize(file.size)}</div>
            <div style={{fontFamily:mono,fontSize:"0.48rem",color:C.text3,letterSpacing:"1px"}}>TAP TO REPLACE</div></>
        : <><div style={{fontFamily:mono,fontSize:"0.62rem",fontWeight:"700",color:C.text2,letterSpacing:"1px"}}>{title}</div>
            <div style={{fontFamily:mono,fontSize:"0.5rem",color:C.text3,lineHeight:1.6,whiteSpace:"pre-line"}}>{hint}</div></>
      }
    </div>
  );
}

function SecHead({ n, title, sub }) {
  return (
    <div style={{marginBottom:"10px"}}>
      <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
        <div style={{width:"18px",height:"18px",background:C.bg4,border:`1px solid ${C.border2}`,borderRadius:"2px",display:"flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontSize:"0.48rem",color:C.gold,fontWeight:"700",flexShrink:0}}>{n}</div>
        <div style={{fontFamily:mono,fontSize:"0.68rem",fontWeight:"700",letterSpacing:"2px",color:C.text,textTransform:"uppercase"}}>{title}</div>
      </div>
      {sub&&<div style={{fontFamily:mono,fontSize:"0.5rem",color:C.text3,marginTop:"3px",paddingLeft:"26px"}}>{sub}</div>}
    </div>
  );
}

function Pills({ opts, val, set, multi }) {
  const on = v => multi?val.includes(v):val===v;
  const toggle = v => { if(multi) set(val.includes(v)?val.filter(x=>x!==v):[...val,v]); else set(v); };
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>
      {opts.map(o=>(
        <button key={o} onClick={()=>toggle(o)} style={{
          padding:"3px 9px",fontFamily:mono,fontSize:"0.5rem",letterSpacing:"1px",textTransform:"uppercase",
          border:`1px solid ${on(o)?C.gold:C.border2}`,background:on(o)?"rgba(212,168,67,0.15)":"transparent",
          color:on(o)?C.goldBright:C.text3,cursor:"pointer",borderRadius:"2px",transition:"all 0.1s"
        }}>{o}</button>
      ))}
    </div>
  );
}

// ── GENERATOR ────────────────────────────────────────────────
function Generator({ apiKey, onVideoReady }) {
  const [imgFile,     setImgFile]     = useState(null);
  const [imgUrl,      setImgUrl]      = useState("");
  const [avatarUrl,   setAvatarUrl]   = useState("");
  const [avatarCopied,setAvatarCopied]= useState(false);
  const [avatarUploading,setAvatarUploading]= useState(false);
  const [audFile,   setAudFile]   = useState(null);
  const [audUrl,    setAudUrl]    = useState("");
  const [voiceFile, setVoiceFile] = useState(null);
  const [voiceUrl,  setVoiceUrl]  = useState("");
  const [perf,      setPerf]      = useState("RAPPING");
  const [lyrics,    setLyrics]    = useState("");
  const [scene,     setScene]     = useState("");
  const [tags,      setTags]      = useState([]);
  const [camera,    setCamera]    = useState("SLOW ORBIT...");
  const [style,     setStyle]     = useState("RED CAMERA...");
  const [dur,       setDur]       = useState("4s");

  const [logs,       setLogs]       = useState([{ ts:"—", msg:"System ready — configure inputs and generate.", type:"ok" }]);
  const [running,    setRunning]    = useState(false);
  const [done,       setDone]       = useState(false);
  const [stagesDone, setStagesDone] = useState([]);
  const [activeStg,  setActiveStg]  = useState("");
  const [poll,       setPoll]       = useState(0);
  const [progress,   setProgress]   = useState(0);
  const [transcript, setTranscript] = useState("");
  const [veoPrompt,  setVeoPrompt]  = useState("");
  const [videoUrl,   setVideoUrl]   = useState("");

  const logRef = useRef();
  useEffect(()=>{ if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight; },[logs]);

  const ts = ()=>{ const d=new Date(); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`; };
  const log = (msg,type="info") => setLogs(p=>[...p,{msg,type,ts:ts()}]);
  const canRun = apiKey.length>10 && imgFile && audFile && scene.trim().length>4;

  const handleGen = async () => {
    if (!canRun||running) return;
    setRunning(true); setDone(false); setLogs([]); setTranscript(""); setVeoPrompt(""); setVideoUrl("");
    setStagesDone([]); setPoll(0); setProgress(0);

    try {
      setActiveStg("ingest"); setProgress(5);
      log("Reading files into memory...","info");
      const imgB64  = await readB64(imgFile);
      const imgMime = imgFile.type||"image/jpeg";
      const audB64  = await readB64(audFile);
      const audMime = audFile.type||"audio/mpeg";
      setStagesDone(p=>[...p,"ingest"]); setProgress(12);
      log("✓ Assets loaded","ok");

      setActiveStg("transcribe"); setProgress(18);
      log("Sending audio to Gemini 2.0 Flash...","gold");
      const txP = lyrics.trim().length>10
        ? `Clean up these lyrics and return them only: "${lyrics.trim()}"`
        : `Transcribe every word from this audio. Return ONLY the words — no timestamps, no formatting.`;
      const tx = await callGemini(apiKey, txP, lyrics.trim().length>10?null:audB64, audMime);
      if (!tx||tx.trim().length<3) throw new Error("Transcription empty — check audio and API key.");
      setTranscript(tx.trim());
      setStagesDone(p=>[...p,"transcribe"]); setProgress(30);
      log(`✓ Transcribed — ${tx.trim().split(" ").length} words`,"ok");

      setActiveStg("prompt"); setProgress(38);
      log("Building Veo 3.1 Fast prompt...","gold");
      const builtP = await callGemini(
        apiKey,
        `You are a Veo 3.1 Fast video prompt engineer. Write ONE cinematic prompt under 350 characters. Return ONLY the prompt — no quotes, no labels.

Performance: ${perf}, Scene: ${scene}, Tags: ${tags.join(", ")||"none"}, Camera: ${camera}, Style: ${style}
Lyrics: ${tx.trim().slice(0,180)}
Subject in image should lip-sync these words with natural mouth movements. Include camera motion, lighting, mood. Max 350 chars.`,
        null, null
      );
      if (!builtP||builtP.trim().length<10) throw new Error("Prompt builder empty.");
      setVeoPrompt(builtP.trim());
      setStagesDone(p=>[...p,"prompt"]); setProgress(45);
      log(`✓ Prompt ready (${builtP.trim().length} chars)`,"ok");

      setActiveStg("generate"); setProgress(50);
      log("Submitting to Veo 3.1 Fast...","gold");
      const opName = await startVeo(apiKey, builtP.trim(), imgB64, imgMime);
      log("✓ Job started — polling every 5s...","ok");

      const vidUri = await pollVeo(apiKey, opName, count => {
        setPoll(count);
        setProgress(Math.min(50+count*0.6, 88));
        if (count%8===0) log(`Polling... ${count}/80`,"info");
      });

      setVideoUrl(vidUri);
      setStagesDone(p=>[...p,"generate","sync","broll","compose","ready"]);
      setActiveStg("ready"); setProgress(100);
      log("✓✓ VIDEO GENERATED","ok");
      log("● Moving to Advanced Studio...","gold");
      setDone(true);

      setTimeout(()=>{
        onVideoReady({ videoUrl:vidUri, transcript:tx.trim(), veoPrompt:builtP.trim(), audioFile:audFile, audioDataUrl:audUrl, imageDataUrl:imgUrl });
      }, 1200);

    } catch(err) {
      log(`✗ ERROR: ${err.message}`,"err");
      setActiveStg("");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div style={{flex:1,display:"grid",gridTemplateColumns:"300px 1fr",overflow:"hidden",minHeight:0}}>

      {/* LEFT */}
      <div style={{borderRight:`1px solid ${C.border}`,overflowY:"auto",display:"flex",flexDirection:"column",gap:0}}>
        <div style={{padding:"14px",display:"flex",flexDirection:"column",gap:"18px"}}>

          {/* FACE DNA */}
          <div>
            <SecHead n="01" title="Face DNA" sub="Front-facing photo — clear face required"/>
            <UploadZone icon="📷" title="TAP TO UPLOAD FACE PHOTO" hint="Head-on shot prevents identity drift"
              accept="image/jpeg,image/png,image/webp" file={imgFile} dataUrl={imgUrl}
              onFile={async (f,u)=>{
                setImgFile(f); setImgUrl(u);
                setAvatarUrl(""); setAvatarCopied(false); setAvatarUploading(true);
                try { const url = await uploadAvatar(f); setAvatarUrl(url); }
                catch(e) { console.error("Avatar upload failed:", e.message); }
                finally { setAvatarUploading(false); }
              }} showImg/>
            {avatarUploading && (
              <div style={{fontFamily:mono,fontSize:"0.48rem",color:C.gold,marginTop:"6px",letterSpacing:"1px"}}>⏳ UPLOADING TO SUPABASE...</div>
            )}
            {avatarUrl && !avatarUploading && (
              <div style={{marginTop:"6px",background:C.bg3,border:`1px solid ${C.green}`,borderRadius:"3px",padding:"8px 10px",display:"flex",alignItems:"center",gap:"6px"}}>
                <div style={{fontFamily:mono,fontSize:"0.44rem",color:C.green,flex:1,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                  ✓ {avatarUrl}
                </div>
                <button onClick={()=>{ navigator.clipboard.writeText(avatarUrl); setAvatarCopied(true); setTimeout(()=>setAvatarCopied(false),2000); }}
                  style={{fontFamily:mono,fontSize:"0.44rem",color:avatarCopied?C.green:C.gold,border:`1px solid ${avatarCopied?C.green:C.gold}`,background:"transparent",padding:"3px 8px",cursor:"pointer",borderRadius:"2px",flexShrink:0,transition:"all 0.15s"}}>
                  {avatarCopied?"✓ COPIED":"COPY"}
                </button>
              </div>
            )}
          </div>

          {/* AUDIO */}
          <div>
            <SecHead n="02" title="Audio Track" sub="Your real song or speech — this IS the audio"/>
            <UploadZone icon="🎧" title="TAP TO UPLOAD SONG / SPEECH" hint=".wav / .mp3 — lip sync locks to this audio"
              accept="audio/*" file={audFile} dataUrl={audUrl}
              onFile={(f,u)=>{setAudFile(f);setAudUrl(u);}}/>
          </div>

          {/* VOICE DNA */}
          <div>
            <SecHead n="03" title="Voice DNA" sub="Optional — 30s min voice sample"/>
            <UploadZone icon="🎤" title="TAP TO UPLOAD VOICE SAMPLE" hint="Builds pitch + cadence model for DNA"
              accept="audio/*" file={voiceFile} dataUrl={voiceUrl}
              onFile={(f,u)=>{setVoiceFile(f);setVoiceUrl(u);}}/>
          </div>

          {/* PERFORMANCE */}
          <div>
            <SecHead n="04" title="Performance" sub="Type — optional lyrics for better sync"/>
            <div style={{marginBottom:"8px"}}><Pills opts={PERF_TYPES} val={perf} set={setPerf}/></div>
            <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,letterSpacing:"1px",marginBottom:"5px"}}>LYRICS / SCRIPT (OPTIONAL — IMPROVES LIP SYNC)</div>
            <textarea value={lyrics} onChange={e=>setLyrics(e.target.value)}
              placeholder="Paste lyrics or speech here..." maxLength={600}
              style={{width:"100%",boxSizing:"border-box",background:C.bg3,border:`1px solid ${C.border2}`,borderRadius:"3px",padding:"8px 10px",fontFamily:mono,fontSize:"0.55rem",color:C.text2,lineHeight:1.7,resize:"vertical",minHeight:"60px",outline:"none"}}/>
          </div>

          {/* SCENE */}
          <div>
            <SecHead n="05" title="Scene Prompt" sub="Where is the artist performing?"/>
            <textarea value={scene} onChange={e=>setScene(e.target.value)}
              placeholder={"Artist rapping on rooftop at sunset,\ncity skyline behind them..."}
              maxLength={300}
              style={{width:"100%",boxSizing:"border-box",background:C.bg3,border:`1px solid ${scene.length>4?C.border2:C.border}`,borderRadius:"3px",padding:"8px 10px",fontFamily:mono,fontSize:"0.55rem",color:C.text2,lineHeight:1.7,resize:"vertical",minHeight:"70px",outline:"none"}}/>
            <div style={{fontFamily:mono,fontSize:"0.43rem",color:C.text3,textAlign:"right",marginTop:"2px"}}>{scene.length}/300</div>
            <div style={{marginTop:"7px"}}><Pills opts={SCENE_TAGS} val={tags} set={setTags} multi/></div>
          </div>

          {/* CAMERA */}
          <div>
            <SecHead n="06" title="Camera + Style"/>
            <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,letterSpacing:"1px",marginBottom:"5px"}}>CAMERA</div>
            <div style={{marginBottom:"8px"}}><Pills opts={CAMERAS} val={camera} set={setCamera}/></div>
            <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,letterSpacing:"1px",marginBottom:"5px"}}>STYLE</div>
            <Pills opts={STYLES} val={style} set={setStyle}/>
          </div>

          {/* DURATION */}
          <div>
            <SecHead n="07" title="Duration"/>
            <Pills opts={DURATIONS} val={dur} set={setDur}/>
          </div>

          {/* GENERATION REQUEST preview */}
          <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"3px",padding:"10px"}}>
            {[
              {k:"artist_dna",   v:imgFile?imgFile.name.slice(0,16)+"…":null},
              {k:"audio_track",  v:audFile?audFile.name.slice(0,16)+"…":null},
              {k:"voice_sample", v:voiceFile?voiceFile.name.slice(0,16)+"…":null},
              {k:"scene_prompt", v:scene.trim().length>4?scene.trim().slice(0,20)+"…":null},
              {k:"camera",       v:camera},
              {k:"styling",      v:style},
              {k:"performance",  v:perf},
              {k:"duration",     v:dur},
              {k:"lyrics",       v:lyrics.trim().length>0?"provided":null},
            ].map(r=>(
              <div key={r.k} style={{fontFamily:mono,fontSize:"0.48rem",lineHeight:1.8,display:"flex",gap:"6px"}}>
                <span style={{color:C.text3}}>{r.k}:</span>
                <span style={{color:r.v?C.green:C.red}}>{r.v||"missing"}</span>
              </div>
            ))}
          </div>

          {/* GENERATE BUTTON */}
          <button onClick={handleGen} disabled={!canRun||running} style={{
            width:"100%",padding:"15px",
            background:done?C.green:canRun?C.gold:C.bg3,
            border:`1px solid ${done?C.green:canRun?C.gold:C.border}`,
            color:canRun?C.bg:C.text3,
            fontFamily:mono,fontWeight:"700",fontSize:"0.7rem",letterSpacing:"3px",textTransform:"uppercase",
            cursor:canRun&&!running?"pointer":"not-allowed",borderRadius:"3px",transition:"all 0.2s",
          }}>
            {running?`● GENERATING${poll>0?` — POLL ${poll}/80`:""}...`:done?"✓ VIDEO READY":"▶ GENERATE VIDEO"}
          </button>
          <div style={{height:"20px"}}/>
        </div>
      </div>

      {/* RIGHT */}
      <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* PIPELINE */}
        <div style={{borderBottom:`1px solid ${C.border}`,padding:"12px 16px",flexShrink:0}}>
          <div style={{fontFamily:mono,fontSize:"0.52rem",letterSpacing:"3px",color:C.gold,marginBottom:"10px"}}>
            REAL PIPELINE — GOOGLE AI MODELS
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"6px",marginBottom:"6px"}}>
            {PIPELINE_STAGES.slice(0,4).map(p=>{
              const isDone=stagesDone.includes(p.id); const isAct=activeStg===p.id&&running;
              return (
                <div key={p.id} style={{background:isDone?"rgba(0,230,118,0.07)":isAct?"rgba(212,168,67,0.07)":C.bg3,border:`1px solid ${isDone?C.green:isAct?C.gold:C.border}`,borderRadius:"3px",padding:"10px 6px",textAlign:"center",transition:"all 0.3s"}}>
                  <div style={{fontSize:"1.2rem",marginBottom:"4px"}}>{isAct?"⚡":isDone?"✓":p.icon}</div>
                  <div style={{fontFamily:mono,fontSize:"0.44rem",color:isDone?C.green:isAct?C.gold:C.text2,fontWeight:isDone||isAct?"700":"400",letterSpacing:"0.5px"}}>{p.name}</div>
                  <div style={{fontFamily:mono,fontSize:"0.38rem",color:C.text3,marginTop:"2px"}}>{p.model}</div>
                </div>
              );
            })}
          </div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"6px"}}>
            {PIPELINE_STAGES.slice(4).map(p=>{
              const isDone=stagesDone.includes(p.id); const isAct=activeStg===p.id&&running;
              return (
                <div key={p.id} style={{background:isDone?"rgba(0,230,118,0.07)":isAct?"rgba(212,168,67,0.07)":C.bg3,border:`1px solid ${isDone?C.green:isAct?C.gold:C.border}`,borderRadius:"3px",padding:"10px 6px",textAlign:"center",transition:"all 0.3s"}}>
                  <div style={{fontSize:"1.2rem",marginBottom:"4px"}}>{isAct?"⚡":isDone?"✓":p.icon}</div>
                  <div style={{fontFamily:mono,fontSize:"0.44rem",color:isDone?C.green:isAct?C.gold:C.text2,fontWeight:isDone||isAct?"700":"400",letterSpacing:"0.5px"}}>{p.name}</div>
                  <div style={{fontFamily:mono,fontSize:"0.38rem",color:C.text3,marginTop:"2px"}}>{p.model}</div>
                </div>
              );
            })}
          </div>
          <div style={{marginTop:"8px",display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div style={{fontFamily:mono,fontSize:"0.44rem",color:C.text3}}>Powered by Google AI Studio</div>
            <div style={{fontFamily:mono,fontSize:"0.44rem",color:C.text3}}>PROGRESS: {progress}%</div>
          </div>
          {running && (
            <div style={{marginTop:"6px",height:"3px",background:C.border,borderRadius:"2px",overflow:"hidden"}}>
              <div style={{height:"100%",width:`${progress}%`,background:C.gold,transition:"width 0.5s",borderRadius:"2px"}}/>
            </div>
          )}
        </div>

        {/* TRANSCRIPT + PROMPT */}
        {(transcript||veoPrompt) && (
          <div style={{borderBottom:`1px solid ${C.border}`,padding:"10px 16px",flexShrink:0,display:"flex",flexDirection:"column",gap:"8px"}}>
            {transcript && (
              <div>
                <div style={{fontFamily:mono,fontSize:"0.44rem",letterSpacing:"2px",color:C.green,marginBottom:"5px"}}>✓ TRANSCRIPT — GEMINI 2.5 FLASH</div>
                <div style={{background:C.bg3,border:`1px solid #0a2018`,borderRadius:"3px",padding:"8px 10px",fontFamily:mono,fontSize:"0.55rem",color:C.text2,lineHeight:1.7,maxHeight:"60px",overflowY:"auto"}}>{transcript}</div>
              </div>
            )}
            {veoPrompt && (
              <div>
                <div style={{fontFamily:mono,fontSize:"0.44rem",letterSpacing:"2px",color:C.gold,marginBottom:"5px"}}>✓ VEO PROMPT USED</div>
                <div style={{background:C.bg3,border:`1px solid rgba(212,168,67,0.2)`,borderRadius:"3px",padding:"8px 10px",fontFamily:mono,fontSize:"0.55rem",color:C.gold,lineHeight:1.7}}>{veoPrompt}</div>
              </div>
            )}
          </div>
        )}

        {/* SYSTEM LOG */}
        <div style={{flex:1,padding:"12px 16px",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{fontFamily:mono,fontSize:"0.52rem",letterSpacing:"3px",color:C.gold,marginBottom:"8px"}}>SYSTEM LOG</div>
          <div ref={logRef} style={{flex:1,background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"3px",padding:"10px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"2px"}}>
            {logs.map((l,i)=>(
              <div key={i} style={{display:"flex",gap:"10px",fontFamily:mono,fontSize:"0.52rem",lineHeight:1.6}}>
                <span style={{color:C.text3,flexShrink:0,minWidth:"52px"}}>{l.ts}</span>
                <span style={{color:C.text3,flexShrink:0}}>SYSTEM</span>
                <span style={{color:l.type==="ok"?C.green:l.type==="err"?C.red:l.type==="gold"?C.gold:C.text2}}>{l.msg}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ADVANCED STUDIO ───────────────────────────────────────────
function AdvancedStudio({ studioData }) {
  const [activeTab,  setActiveTab]  = useState("CLIPS");
  const [playing,    setPlaying]    = useState(false);
  const [currentTime,setCurrentTime]= useState(0);
  const [duration,   setDuration]   = useState(30);
  const [volume,     setVolume]     = useState(80);
  const [zoom,       setZoom]       = useState(100);
  const videoRef = useRef();
  const hasVideo = !!studioData?.videoUrl;

  useEffect(()=>{
    const v = videoRef.current; if(!v) return;
    const onTime = ()=>setCurrentTime(v.currentTime);
    const onMeta = ()=>setDuration(v.duration||30);
    v.addEventListener("timeupdate",onTime);
    v.addEventListener("loadedmetadata",onMeta);
    return ()=>{ v.removeEventListener("timeupdate",onTime); v.removeEventListener("loadedmetadata",onMeta); };
  },[studioData]);

  const togglePlay = ()=>{ const v=videoRef.current; if(!v)return; playing?v.pause():v.play(); setPlaying(!playing); };
  const skipTo = t => { const v=videoRef.current; if(!v)return; v.currentTime=t; setCurrentTime(t); };

  const TABS = ["CLIPS","FX","EXTEND","AUDIO"];
  const TRACKS = [
    {id:"video",    icon:"🎬", label:"VIDEO"},
    {id:"audio",    icon:"🎵", label:"ORIG AUDIO"},
    {id:"broll",    icon:"🎥", label:"B-ROLL"},
    {id:"effects",  icon:"✨", label:"EFFECTS"},
  ];

  const pxPerSec = 60;
  const totalW   = Math.max(duration * pxPerSec, 600);
  const playheadX = currentTime * pxPerSec;

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      <div style={{flex:1,display:"grid",gridTemplateColumns:"1fr 340px",overflow:"hidden",minHeight:0}}>

        {/* VIDEO PLAYER */}
        <div style={{borderRight:`1px solid ${C.border}`,display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{flex:1,background:"#000",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",minHeight:0}}>
            {hasVideo
              ? <video ref={videoRef} src={studioData.videoUrl} style={{maxWidth:"100%",maxHeight:"100%",objectFit:"contain"}} loop/>
              : <div style={{textAlign:"center"}}>
                  <div style={{fontSize:"3rem",opacity:0.15,marginBottom:"10px"}}>▶</div>
                  <div style={{fontFamily:mono,fontSize:"0.55rem",color:C.text3,letterSpacing:"2px"}}>Generate a video first</div>
                </div>
            }
          </div>

          {/* PLAYBACK CONTROLS */}
          <div style={{padding:"10px 16px",borderTop:`1px solid ${C.border}`,background:C.bg2,display:"flex",alignItems:"center",gap:"8px",flexShrink:0}}>
            <button onClick={()=>skipTo(0)} style={btnStyle}>⏮</button>
            <button onClick={togglePlay} style={{...btnStyle,background:C.bg4}}>{playing?"⏸":"▶"}</button>
            <button onClick={()=>skipTo(Math.min(currentTime+5,duration))} style={btnStyle}>⏩</button>
            <button onClick={()=>skipTo(duration)} style={btnStyle}>⏭</button>
            <div style={{fontFamily:mono,fontSize:"0.6rem",color:C.gold,marginLeft:"4px",minWidth:"90px"}}>{fmtTime(currentTime)} / {fmtTime(duration)}</div>
            <div style={{flex:1}}/>
            <span style={{fontSize:"0.9rem",opacity:0.5}}>🔊</span>
            <input type="range" min={0} max={100} value={volume}
              onChange={e=>{ setVolume(+e.target.value); if(videoRef.current) videoRef.current.volume=+e.target.value/100; }}
              style={{width:"80px",accentColor:C.gold}}/>
            <span style={{fontFamily:mono,fontSize:"0.52rem",color:C.text3}}>{volume}%</span>
            <button onClick={()=>setZoom(z=>Math.max(25,z-25))} style={btnStyle}>−</button>
            <span style={{fontFamily:mono,fontSize:"0.52rem",color:C.text3,minWidth:"36px",textAlign:"center"}}>{zoom}%</span>
            <button onClick={()=>setZoom(z=>Math.min(200,z+25))} style={btnStyle}>+</button>
          </div>
        </div>

        {/* RIGHT PANEL — TABS */}
        <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            {TABS.map(t=>(
              <button key={t} onClick={()=>setActiveTab(t)} style={{
                flex:1,padding:"10px 4px",fontFamily:mono,fontSize:"0.52rem",letterSpacing:"1px",fontWeight:"700",
                border:"none",borderBottom:`2px solid ${activeTab===t?C.gold:"transparent"}`,
                background:"transparent",color:activeTab===t?C.gold:C.text3,cursor:"pointer",transition:"all 0.15s",
              }}>
                {t==="CLIPS"?"🎬 ":t==="FX"?"✨ ":t==="EXTEND"?"⚡ ":"🎵 "}{t}
              </button>
            ))}
          </div>

          <div style={{flex:1,padding:"14px",overflowY:"auto"}}>
            {activeTab==="CLIPS" && (
              <>
                <div style={{fontFamily:mono,fontSize:"0.52rem",letterSpacing:"2px",color:C.text2,marginBottom:"10px"}}>GENERATED CLIPS — ADD TO TIMELINE</div>
                {hasVideo
                  ? <div style={{background:C.bg3,border:`1px solid ${C.green}`,borderRadius:"3px",padding:"10px",display:"flex",gap:"10px",alignItems:"center",cursor:"pointer"}}>
                      <div style={{fontSize:"1.2rem"}}>🎬</div>
                      <div>
                        <div style={{fontFamily:mono,fontSize:"0.58rem",color:C.green,fontWeight:"700"}}>✓ Main Performance</div>
                        <div style={{fontFamily:mono,fontSize:"0.48rem",color:C.text3,marginTop:"2px"}}>Veo 3.1 Fast · 8s · 9:16</div>
                      </div>
                    </div>
                  : <div style={{fontFamily:mono,fontSize:"0.52rem",color:C.text3}}>No clips — generate a video first</div>
                }
              </>
            )}
            {activeTab==="FX" && (
              <>
                <div style={{fontFamily:mono,fontSize:"0.52rem",letterSpacing:"2px",color:C.text2,marginBottom:"10px"}}>VISUAL EFFECTS</div>
                {["FILM GRAIN","COLOR GRADE","LENS FLARE","VIGNETTE","GLOW","SHARPEN"].map(fx=>(
                  <div key={fx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:C.bg3,border:`1px solid ${C.border}`,borderRadius:"3px",marginBottom:"4px"}}>
                    <span style={{fontFamily:mono,fontSize:"0.52rem",color:C.text2}}>{fx}</span>
                    <button style={{fontFamily:mono,fontSize:"0.46rem",color:C.gold,border:`1px solid ${C.gold}`,background:"transparent",padding:"2px 8px",cursor:"pointer",borderRadius:"2px"}}>ADD</button>
                  </div>
                ))}
              </>
            )}
            {activeTab==="EXTEND" && (
              <>
                <div style={{fontFamily:mono,fontSize:"0.52rem",letterSpacing:"2px",color:C.text2,marginBottom:"10px"}}>EXTEND VIDEO</div>
                <div style={{fontFamily:mono,fontSize:"0.55rem",color:C.text3,lineHeight:1.7,marginBottom:"12px"}}>Generate additional clips and add them to the timeline to extend the video.</div>
                <textarea placeholder="Describe the next scene to generate..." style={{width:"100%",boxSizing:"border-box",background:C.bg3,border:`1px solid ${C.border2}`,borderRadius:"3px",padding:"8px",fontFamily:mono,fontSize:"0.55rem",color:C.text2,resize:"vertical",minHeight:"70px",outline:"none"}}/>
                <button style={{marginTop:"8px",width:"100%",padding:"10px",background:C.gold,border:"none",color:C.bg,fontFamily:mono,fontSize:"0.6rem",fontWeight:"700",letterSpacing:"2px",cursor:"pointer",borderRadius:"3px"}}>⚡ GENERATE NEXT CLIP</button>
              </>
            )}
            {activeTab==="AUDIO" && (
              <>
                <div style={{fontFamily:mono,fontSize:"0.52rem",letterSpacing:"2px",color:C.text2,marginBottom:"10px"}}>AUDIO TRACKS</div>
                {hasVideo&&studioData?.audioFile && (
                  <div style={{background:C.bg3,border:`1px solid ${C.green}`,borderRadius:"3px",padding:"10px",marginBottom:"6px"}}>
                    <div style={{fontFamily:mono,fontSize:"0.58rem",color:C.green,fontWeight:"700"}}>✓ Original Audio</div>
                    <div style={{fontFamily:mono,fontSize:"0.48rem",color:C.text3,marginTop:"2px"}}>{studioData.audioFile.name}</div>
                  </div>
                )}
                {!hasVideo && <div style={{fontFamily:mono,fontSize:"0.52rem",color:C.text3}}>Generate a video to see audio tracks</div>}
              </>
            )}
          </div>
        </div>
      </div>

      {/* TIMELINE */}
      <div style={{borderTop:`1px solid ${C.border}`,background:C.bg2,flexShrink:0}}>
        {/* TIMELINE HEADER */}
        <div style={{display:"flex",alignItems:"center",padding:"6px 12px",borderBottom:`1px solid ${C.border}`,gap:"8px"}}>
          <div style={{fontFamily:mono,fontSize:"0.58rem",fontWeight:"700",letterSpacing:"2px",color:C.gold}}>TIMELINE</div>
          {["CUT","TRIM","SPLIT"].map(t=>(
            <button key={t} style={{fontFamily:mono,fontSize:"0.48rem",color:C.text2,border:`1px solid ${C.border2}`,background:C.bg3,padding:"3px 10px",cursor:"pointer",borderRadius:"2px",letterSpacing:"1px"}}>{t}</button>
          ))}
          <div style={{flex:1}}/>
          <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3}}>{fmtTime(currentTime)} / {fmtTime(duration)} · {zoom}%</div>
          {["MP4","MOV"].map(f=>(
            <button key={f} style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,border:`1px solid ${C.border2}`,background:C.bg3,padding:"3px 8px",cursor:"pointer",borderRadius:"2px"}}>↓ {f}</button>
          ))}
          <button style={{fontFamily:mono,fontSize:"0.46rem",color:C.gold,border:`1px solid ${C.gold}`,background:"transparent",padding:"3px 8px",cursor:"pointer",borderRadius:"2px"}}>9:16</button>
        </div>

        {/* TRACKS */}
        <div style={{display:"flex",overflow:"hidden"}}>
          {/* TRACK LABELS */}
          <div style={{width:"110px",flexShrink:0,borderRight:`1px solid ${C.border}`}}>
            <div style={{height:"20px",borderBottom:`1px solid ${C.border}`,background:C.bg3}}/>
            {TRACKS.map(tr=>(
              <div key={tr.id} style={{height:"36px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",padding:"0 10px",gap:"6px"}}>
                <span style={{fontSize:"0.8rem"}}>{tr.icon}</span>
                <span style={{fontFamily:mono,fontSize:"0.48rem",color:C.text3,letterSpacing:"0.5px"}}>{tr.label}</span>
                <span style={{marginLeft:"auto",fontSize:"0.7rem",opacity:0.4}}>🔊</span>
              </div>
            ))}
          </div>

          {/* TRACK CONTENT */}
          <div style={{flex:1,overflowX:"auto",position:"relative"}}>
            {/* RULER */}
            <div style={{height:"20px",borderBottom:`1px solid ${C.border}`,position:"relative",minWidth:`${totalW}px`,background:C.bg3}}>
              {Array.from({length:Math.ceil(duration)+1},(_,i)=>(
                <div key={i} style={{position:"absolute",left:`${i*pxPerSec*(zoom/100)}px`,top:0,height:"100%",borderLeft:`1px solid ${C.border2}`,display:"flex",alignItems:"flex-end",paddingBottom:"2px"}}>
                  <span style={{fontFamily:mono,fontSize:"0.38rem",color:C.text3,paddingLeft:"2px"}}>{fmtTime(i)}</span>
                </div>
              ))}
              {/* PLAYHEAD */}
              <div style={{position:"absolute",left:`${playheadX*(zoom/100)}px`,top:0,height:`${20+4*36}px`,width:"2px",background:C.gold,zIndex:10,pointerEvents:"none"}}/>
            </div>

            {/* TRACK ROWS */}
            {TRACKS.map((tr,ti)=>(
              <div key={tr.id} style={{height:"36px",borderBottom:`1px solid ${C.border}`,position:"relative",minWidth:`${totalW}px`,background:ti%2===0?C.bg3:C.bg2}}>
                {tr.id==="video" && hasVideo && (
                  <div style={{position:"absolute",left:"2px",top:"4px",height:"28px",width:`${Math.min(8*pxPerSec*(zoom/100),totalW-4)}px`,background:"rgba(212,168,67,0.25)",border:`1px solid ${C.gold}`,borderRadius:"2px",display:"flex",alignItems:"center",padding:"0 8px"}}>
                    <span style={{fontFamily:mono,fontSize:"0.42rem",color:C.gold}}>🎬 Main Performance · 8s</span>
                  </div>
                )}
                {tr.id==="audio" && hasVideo && studioData?.audioFile && (
                  <div style={{position:"absolute",left:"2px",top:"4px",height:"28px",width:`${totalW-4}px`,background:"rgba(0,230,118,0.12)",border:`1px solid ${C.green}`,borderRadius:"2px",display:"flex",alignItems:"center",padding:"0 8px"}}>
                    <span style={{fontFamily:mono,fontSize:"0.42rem",color:C.green}}>🎵 {studioData.audioFile.name.slice(0,30)}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const btnStyle = {
  width:"28px",height:"28px",background:C.bg3,border:`1px solid ${C.border2}`,
  color:C.text2,cursor:"pointer",borderRadius:"3px",fontSize:"0.75rem",
  display:"flex",alignItems:"center",justifyContent:"center",fontFamily:mono,
};

// ── ROOT ─────────────────────────────────────────────────────
export default function ChadStudioIO() {
  const [screen,     setScreen]     = useState("GENERATOR");
  const [apiKey,     setApiKey]     = useState("");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [studioData, setStudioData] = useState(null);

  const handleVideoReady = data => {
    setStudioData(data);
    setScreen("ADVANCED STUDIO");
  };

  return (
    <div style={{height:"100vh",background:C.bg,color:C.text,fontFamily:mono,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* NAV */}
      <nav style={{display:"flex",alignItems:"center",padding:"0 16px",height:"46px",borderBottom:`1px solid ${C.border}`,background:C.bg,flexShrink:0,gap:"20px"}}>
        <div style={{fontFamily:mono,fontWeight:"700",fontSize:"0.9rem",letterSpacing:"2px",textTransform:"uppercase"}}>
          <span style={{color:C.gold}}>CHAD</span><span style={{color:C.text}}>STUDIO</span><span style={{color:C.text3}}>.IO</span>
        </div>
        <div style={{display:"flex",gap:"0"}}>
          {SCREENS.map(s=>(
            <button key={s} onClick={()=>setScreen(s)} style={{
              padding:"6px 20px",fontSize:"0.56rem",letterSpacing:"2px",fontFamily:mono,fontWeight:"700",textTransform:"uppercase",
              border:"none",borderBottom:`2px solid ${screen===s?C.gold:"transparent"}`,
              background:"transparent",color:screen===s?C.gold:C.text3,cursor:"pointer",transition:"all 0.15s",
            }}>
              {s==="GENERATOR"?"🎬 ":"⚡ "}{s}
            </button>
          ))}
        </div>
        <div style={{flex:1}}/>
        <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
          <div style={{width:"7px",height:"7px",borderRadius:"50%",background:apiKey.length>10?C.green:C.red}}/>
          <div style={{fontFamily:mono,fontSize:"0.48rem",letterSpacing:"1px",color:apiKey.length>10?C.green:C.red}}>
            {apiKey.length>10?"GOOGLE AI CONNECTED":"NOT CONNECTED"}
          </div>
        </div>
      </nav>

      {/* STATUS BAR */}
      <StatusBar apiKey={apiKey} onChangeKey={()=>setShowKeyInput(s=>!s)}/>

      {/* KEY INPUT DROPDOWN */}
      {showKeyInput && (
        <div style={{padding:"10px 16px",background:C.bg4,borderBottom:`1px solid ${C.border}`,display:"flex",gap:"10px",alignItems:"center",flexShrink:0}}>
          <input type="password" placeholder="Paste your Google AI Studio API key..." value={apiKey} onChange={e=>setApiKey(e.target.value)}
            style={{flex:1,background:C.bg3,border:`1px solid ${apiKey.length>10?C.green:C.border2}`,borderRadius:"3px",padding:"8px 12px",fontFamily:mono,fontSize:"0.6rem",color:apiKey.length>10?C.green:C.text2,outline:"none"}}/>
          <button onClick={()=>setShowKeyInput(false)} style={{fontFamily:mono,fontSize:"0.55rem",color:C.text3,border:`1px solid ${C.border2}`,background:C.bg3,padding:"8px 14px",cursor:"pointer",borderRadius:"3px"}}>CLOSE</button>
        </div>
      )}

      {/* CONTENT */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {screen==="GENERATOR"       && <Generator apiKey={apiKey} onVideoReady={handleVideoReady}/>}
        {screen==="ADVANCED STUDIO" && <AdvancedStudio studioData={studioData}/>}
      </div>

    </div>
  );
}
