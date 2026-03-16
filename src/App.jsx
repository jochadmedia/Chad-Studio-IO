import { useState, useRef, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
const C = {
  bg:"#080808", bg2:"#0f0f0f", bg3:"#141414", bg4:"#1a1a1a",
  border:"#1e1e1e", border2:"#2a2a2a",
  gold:"#d4a843", goldBright:"#f0c040",
  text:"#e8e4dc", text2:"#8a8680", text3:"#444440",
  green:"#00e676", greenDim:"#0a2018",
  red:"#ff3d3d",
};
const mono = "'Courier New', Courier, monospace";
const fmtSize = b => b<1024*1024?`${(b/1024).toFixed(0)} KB`:`${(b/(1024*1024)).toFixed(1)} MB`;
const fmtTime = s => `${String(Math.floor(s/60)).padStart(2,"0")}:${String(Math.floor(s%60)).padStart(2,"0")}`;
const sleep = ms => new Promise(r=>setTimeout(r,ms));

function useIsMobile() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const handler = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener("resize", handler);
    return () => window.removeEventListener("resize", handler);
  }, []);
  return isMobile;
}

const PERF_TYPES = ["RAPPING","SINGING","SPEECH","FREESTYLE"];
const SCENE_TAGS = ["ROOFTOP","CITY STREET","STUDIO","TOKYO","PARIS","DESERT","CONCERT HALL","WAREHOUSE"];
const CAMERAS    = ["SLOW ORBIT","CLOSE-UP","BIRD SHOT","MEDIUM","ORBIT 360°","SLOW DOLLY","HANDHELD","DOLLY ZOOM","SLOW MO"];
const STYLES     = ["RED CAMERA","ANAMORPHIC","FILM GRAIN","4K HDR","NEON LIT","GOLDEN HOUR","CINEMATIC"];
const DURATIONS  = ["4s","6s","8s"];
const SCREENS    = ["GENERATOR","ADVANCED STUDIO"];

const PIPELINE_STAGES = [
  { id:"ingest",    icon:"📁", name:"ASSET INGEST",     model:"Local → Memory"   },
  { id:"transcribe",icon:"🎙", name:"AUDIO TRANSCRIBE", model:"gemini-2.5-flash" },
  { id:"prompt",    icon:"🧠", name:"PROMPT BUILD",      model:"gemini-2.5-flash" },
  { id:"generate",  icon:"🎬", name:"VIDEO GENERATE",    model:"veo-3.1-fast-001" },
  { id:"sync",      icon:"🔄", name:"SYNC ANALYSIS",     model:"gemini-2.5-flash" },
  { id:"broll",     icon:"🎥", name:"B-ROLL GENERATE",   model:"veo-3.1-fast-001" },
  { id:"compose",   icon:"🎞", name:"COMPOSE",           model:"Merge + Grade"   },
  { id:"ready",     icon:"✅", name:"READY",             model:"Studio Unlock"   },
];

// ── FILE UTILS ────────────────────────────────────────────────
function readB64(file) {
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result.split(",")[1]);r.onerror=()=>rej(new Error("read failed"));r.readAsDataURL(file);});
}
function readDataUrl(file) {
  return new Promise((res,rej)=>{const r=new FileReader();r.onload=()=>res(r.result);r.onerror=()=>rej(new Error("read failed"));r.readAsDataURL(file);});
}

// ── GOOGLE AI APIS ────────────────────────────────────────────
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

// Nano Banana 2 = gemini-3.1-flash-image-preview (launched Feb 26 2026)
// Uses generateContent endpoint — NOT Imagen's :predict endpoint
// Response: scan candidates[0].content.parts[] for part with inlineData
async function callNanoBanana2(apiKey, prompt, referenceB64) {
  const parts = [];
  if (referenceB64) {
    const b64data = referenceB64.startsWith("data:") ? referenceB64.split(",")[1] : referenceB64;
    const mime    = referenceB64.startsWith("data:image/png") ? "image/png" : "image/jpeg";
    parts.push({ inlineData:{ mimeType:mime, data:b64data } });
  }
  parts.push({ text:`Cinematic portrait photograph. ${prompt}. Head-on shot, clear face, professional studio lighting, sharp focus, photorealistic.` });
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-image-preview:generateContent?key=${apiKey}`,
    { method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{ role:"user", parts }],
        generationConfig:{ responseModalities:["TEXT","IMAGE"] }
      })
    }
  );
  if (!res.ok) {
    const e = await res.json().catch(()=>({}));
    if (res.status===400) throw new Error(`Nano Banana 2 rejected prompt — ${e?.error?.message||"bad request"}`);
    if (res.status===403) throw new Error("Nano Banana 2 access denied — ensure paid-tier API key at aistudio.google.com");
    if (res.status===429) throw new Error("Rate limit — wait 60s and try again.");
    throw new Error(e?.error?.message||`Nano Banana 2 error ${res.status}`);
  }
  const d = await res.json();
  const parts_out = d?.candidates?.[0]?.content?.parts || [];
  const imgPart   = parts_out.find(p => p.inlineData?.mimeType?.startsWith("image/"));
  if (!imgPart) {
    if (d?.candidates?.[0]?.finishReason==="SAFETY") throw new Error("Nano Banana 2 blocked — rephrase the artist description.");
    throw new Error("Nano Banana 2 returned no image. Check your API key has image generation access.");
  }
  return `data:${imgPart.inlineData.mimeType};base64,${imgPart.inlineData.data}`;
}

async function startVeo(apiKey, prompt, imgB64, imgMime, durationSeconds=8) {
  const instance = { prompt };
  if (imgB64) instance.image = { bytesBase64Encoded: imgB64, mimeType: imgMime };
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/veo-3.1-fast-generate-001:predictLongRunning?key=${apiKey}`,
    { method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        instances: [instance],
        parameters: {
          aspectRatio: "9:16",
          durationSeconds,
          personGeneration: "allow_adult",
          mediaResolution: "MEDIA_RESOLUTION_MEDIUM",
          enhancePrompt: false,
        }
      })
    }
  );
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||`Veo ${res.status}`); }
  const d = await res.json();
  if (!d.name) throw new Error("No operation name returned from Veo.");
  return d.name;
}

async function pollVeo(apiKey, opName, onPoll, onRateLimit) {
  for (let i=0;i<80;i++) {
    await sleep(5000); onPoll(i+1);
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/${opName}?key=${apiKey}`);
    // 7.8 — rate limit: wait 60s then retry automatically
    if (res.status === 429) {
      for (let s=60; s>0; s--) {
        onRateLimit?.(`Rate limited — retrying in ${s}s...`);
        await sleep(1000);
      }
      continue; // retry this poll iteration
    }
    if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||`Poll ${res.status}`); }
    const d = await res.json();
    if (d.done) {
      if (d.error) throw new Error(d.error.message||"Veo job failed.");
      const s = (d.response?.generatedSamples||d.response?.videos||[])[0];
      const uri = s?.video?.uri||s?.videoUri||s?.uri;
      if (!uri) throw new Error("No video URI in Veo response.");
      return uri;
    }
  }
  throw new Error("Veo timed out after ~6 min. Check your quota.");
}

// Gemini video analysis — uses fileData URI (NOT inline base64)
// The Veo completion URI is a Google Storage URL readable by Gemini directly with the same API key
async function callGeminiVideo(apiKey, videoUri, prompt) {
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    { method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({
        contents:[{ role:"user", parts:[
          { fileData:{ mimeType:"video/mp4", fileUri:videoUri } },
          { text:prompt }
        ]}]
      })
    }
  );
  if (!res.ok) { const e=await res.json().catch(()=>({})); throw new Error(e?.error?.message||`Gemini Video ${res.status}`); }
  const d = await res.json();
  return d?.candidates?.[0]?.content?.parts?.[0]?.text||"";
}

// ── SHARED UI ─────────────────────────────────────────────────
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
  const tog = v => { if(multi) set(val.includes(v)?val.filter(x=>x!==v):[...val,v]); else set(v); };
  return (
    <div style={{display:"flex",flexWrap:"wrap",gap:"4px"}}>
      {opts.map(o=>(
        <button key={o} onClick={()=>tog(o)} style={{
          padding:"3px 9px",fontFamily:mono,fontSize:"0.5rem",letterSpacing:"1px",textTransform:"uppercase",
          border:`1px solid ${on(o)?C.gold:C.border2}`,background:on(o)?"rgba(212,168,67,0.15)":"transparent",
          color:on(o)?C.goldBright:C.text3,cursor:"pointer",borderRadius:"2px",transition:"all 0.1s",
        }}>{o}</button>
      ))}
    </div>
  );
}

function StatusBar({ apiKey, onChangeKey }) {
  return (
    <div style={{padding:"0 16px",height:"36px",background:apiKey.length>10?C.greenDim:C.bg2,borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",justifyContent:"space-between",flexShrink:0}}>
      <div style={{fontFamily:mono,fontSize:"0.52rem",color:apiKey.length>10?C.green:C.text3,letterSpacing:"0.5px"}}>
        {apiKey.length>10
          ? "✓ GOOGLE AI STUDIO CONNECTED — GEMINI 2.5 FLASH · VEO 3.1 FAST · NANO BANANA 2 READY"
          : "ENTER YOUR GOOGLE AI STUDIO API KEY TO CONNECT"}
      </div>
      <button onClick={onChangeKey} style={{fontFamily:mono,fontSize:"0.5rem",color:C.gold,border:`1px solid ${C.gold}`,background:"transparent",padding:"3px 10px",cursor:"pointer",letterSpacing:"1px"}}>
        CHANGE KEY
      </button>
    </div>
  );
}

// ── IMAGE WORKSHOP (Step 01 — expandable Imagen 3) ────────────
function ImageWorkshop({ apiKey, imgFile, imgUrl, setImgFile, setImgUrl }) {
  const [expanded,   setExpanded]   = useState(false);
  const [imgPrompt,  setImgPrompt]  = useState("");
  const [generating, setGenerating] = useState(false);
  const [genError,   setGenError]   = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const uploadRef = useRef();

  const handleUpload = async f => {
    if (!f) return;
    const du = await readDataUrl(f);
    setImgFile(f); setImgUrl(du); setPreviewUrl("");
  };

  const handleGenerate = async () => {
    if (!apiKey||apiKey.length<10) { setGenError("Enter API key first."); return; }
    if (!imgPrompt.trim()) { setGenError("Describe the artist look first."); return; }
    setGenerating(true); setGenError(""); setPreviewUrl("");
    try {
      const url = await callNanoBanana2(apiKey, imgPrompt.trim());
      setPreviewUrl(url);
    } catch(e) { setGenError(e.message); }
    finally { setGenerating(false); }
  };

  const handleApprove = () => {
    // Convert data: URL directly with atob() — no fetch() needed and avoids CORS on data: URLs
    const [header, b64] = previewUrl.split(",");
    const mime = header.match(/:(.*?);/)?.[1] || "image/png";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mime });
    const f = new File([blob], "nano-banana2-artist.png", { type: mime });
    setImgFile(f); setImgUrl(previewUrl);
    setPreviewUrl(""); setExpanded(false);
  };

  return (
    <div>
      <SecHead n="01" title="Image Workshop" sub="Upload a photo OR generate with Nano Banana 2"/>

      {/* Approved image pill */}
      {imgUrl && (
        <div style={{display:"flex",alignItems:"center",gap:"10px",background:C.bg3,border:`1px solid ${C.green}`,borderRadius:"3px",padding:"10px",marginBottom:"8px"}}>
          <img src={imgUrl} alt="" style={{width:"52px",height:"52px",objectFit:"cover",borderRadius:"3px",border:`1px solid ${C.green}`}}/>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontFamily:mono,fontSize:"0.6rem",fontWeight:"700",color:C.green}}>✓ IMAGE APPROVED — READY FOR VEO</div>
            <div style={{fontFamily:mono,fontSize:"0.48rem",color:C.text3,marginTop:"2px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{imgFile?.name||"Generated by Nano Banana 2"}</div>
          </div>
          <button onClick={()=>{setImgFile(null);setImgUrl("");setPreviewUrl("");}} style={{fontFamily:mono,fontSize:"0.46rem",color:C.red,border:`1px solid ${C.red}`,background:"transparent",padding:"3px 8px",cursor:"pointer",borderRadius:"2px",flexShrink:0}}>✕ CLEAR</button>
        </div>
      )}

      {/* Upload zone — only shown when no image approved */}
      {!imgUrl && (
        <div onClick={()=>uploadRef.current?.click()}
          style={{border:`1px dashed ${C.border2}`,borderRadius:"3px",padding:"16px",background:C.bg3,cursor:"pointer",textAlign:"center",marginBottom:"8px",transition:"all 0.15s"}}
          onMouseOver={e=>e.currentTarget.style.borderColor=C.gold}
          onMouseOut={e=>e.currentTarget.style.borderColor=C.border2}>
          <input ref={uploadRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" style={{display:"none"}} onChange={e=>handleUpload(e.target.files[0])}/>
          <div style={{fontSize:"1.8rem",opacity:0.35,marginBottom:"6px"}}>📷</div>
          <div style={{fontFamily:mono,fontSize:"0.62rem",fontWeight:"700",color:C.text2,letterSpacing:"1px"}}>TAP TO UPLOAD FACE PHOTO</div>
          <div style={{fontFamily:mono,fontSize:"0.5rem",color:C.text3,marginTop:"3px"}}>Head-on shot — clear face required</div>
        </div>
      )}

      {/* Nano Banana 2 toggle button */}
      <button onClick={()=>setExpanded(e=>!e)} style={{
        width:"100%",padding:"8px",background:"transparent",border:`1px solid ${C.gold}`,
        fontFamily:mono,fontSize:"0.52rem",letterSpacing:"2px",color:C.gold,cursor:"pointer",borderRadius:"3px",
        display:"flex",alignItems:"center",justifyContent:"center",gap:"8px",transition:"all 0.15s",
      }}>
        <span>✨</span>
        <span>GENERATE WITH NANO BANANA 2</span>
        <span style={{marginLeft:"auto",opacity:0.6,fontSize:"0.6rem"}}>{expanded?"▲":"▼"}</span>
      </button>

      {/* Nano Banana 2 panel */}
      {expanded && (
        <div style={{marginTop:"6px",background:C.bg2,border:`1px solid rgba(212,168,67,0.3)`,borderRadius:"3px",padding:"12px",display:"flex",flexDirection:"column",gap:"10px"}}>
          <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.gold,letterSpacing:"2px"}}>✨ NANO BANANA 2 · DESCRIBE THE ARTIST LOOK</div>

          <textarea value={imgPrompt} onChange={e=>setImgPrompt(e.target.value)}
            placeholder={"e.g. Black male, 30s, wearing gold chain and dark hoodie,\nconfident expression, neutral background"}
            maxLength={400}
            style={{width:"100%",boxSizing:"border-box",background:C.bg3,border:`1px solid ${C.border2}`,borderRadius:"3px",padding:"8px 10px",fontFamily:mono,fontSize:"0.55rem",color:C.text2,lineHeight:1.7,resize:"vertical",minHeight:"80px",outline:"none"}}/>
          <div style={{fontFamily:mono,fontSize:"0.43rem",color:C.text3,textAlign:"right",marginTop:"-6px"}}>{imgPrompt.length}/400</div>

          <button onClick={handleGenerate} disabled={generating||!imgPrompt.trim()} style={{
            padding:"9px",fontFamily:mono,fontWeight:"700",fontSize:"0.6rem",letterSpacing:"2px",cursor:generating||!imgPrompt.trim()?"not-allowed":"pointer",borderRadius:"3px",
            background:generating?"rgba(212,168,67,0.1)":C.gold,border:`1px solid ${C.gold}`,color:generating?C.gold:C.bg,
          }}>
            {generating?"⚡ GENERATING WITH NANO BANANA 2...":"▶ GENERATE FACE"}
          </button>

          {genError && <div style={{fontFamily:mono,fontSize:"0.52rem",color:C.red}}>✗ {genError}</div>}

          {previewUrl && (
            <div style={{display:"flex",flexDirection:"column",gap:"8px"}}>
              <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,letterSpacing:"1px"}}>PREVIEW — APPROVE OR REGENERATE</div>
              <img src={previewUrl} alt="Nano Banana 2 output" style={{width:"100%",borderRadius:"3px",border:`1px solid ${C.border2}`,maxHeight:"240px",objectFit:"cover"}}/>
              <div style={{display:"flex",gap:"6px"}}>
                <button onClick={handleApprove} style={{flex:1,padding:"9px",background:C.green,border:"none",color:C.bg,fontFamily:mono,fontWeight:"700",fontSize:"0.58rem",letterSpacing:"1px",cursor:"pointer",borderRadius:"3px"}}>
                  ✓ APPROVE — USE THIS IMAGE
                </button>
                <button onClick={handleGenerate} disabled={generating} style={{padding:"9px 14px",background:"transparent",border:`1px solid ${C.border2}`,color:C.text3,fontFamily:mono,fontSize:"0.7rem",cursor:"pointer",borderRadius:"3px"}}>
                  ↺
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── AUDIO SECTION (Step 02 — with optional transcribe button) ─
function AudioSection({ apiKey, audFile, audUrl, setAudFile, setAudUrl, lyrics, setLyrics, transcript, setTranscript }) {
  const [transcribing, setTranscribing] = useState(false);
  const [txError,      setTxError]      = useState("");
  const uploadRef = useRef();

  const handleUpload = async f => {
    if (!f) return;
    const du = await readDataUrl(f);
    setAudFile(f); setAudUrl(du);
  };

  const handleTranscribe = async () => {
    if (!audFile||!apiKey||transcribing) return;
    setTranscribing(true); setTxError("");
    try {
      const b64  = await readB64(audFile);
      const mime = audFile.type||"audio/mpeg";
      const tx = await callGemini(apiKey,
        `Transcribe every word from this audio accurately. Return ONLY the transcribed words — no timestamps, no labels, no extra text.`,
        b64, mime);
      if (!tx||tx.trim().length<3) throw new Error("No text returned. Check audio quality.");
      setTranscript(tx.trim());
      setLyrics(tx.trim());
    } catch(e) { setTxError(e.message); }
    finally { setTranscribing(false); }
  };

  return (
    <div>
      <SecHead n="02" title="Audio Track" sub="Your real song — this IS the final audio"/>

      {/* Upload zone */}
      {audFile
        ? <div style={{display:"flex",alignItems:"center",gap:"10px",background:C.bg3,border:`1px solid ${C.green}`,borderRadius:"3px",padding:"10px",marginBottom:"8px"}}>
            <div style={{fontSize:"1.4rem"}}>🎵</div>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontFamily:mono,fontSize:"0.6rem",fontWeight:"700",color:C.green}}>✓ {audFile.name.length>28?audFile.name.slice(0,25)+"…":audFile.name}</div>
              <div style={{fontFamily:mono,fontSize:"0.48rem",color:C.text3,marginTop:"2px"}}>{fmtSize(audFile.size)}</div>
            </div>
            <button onClick={()=>{setAudFile(null);setAudUrl("");setTranscript("");setLyrics("");}} style={{fontFamily:mono,fontSize:"0.46rem",color:C.red,border:`1px solid ${C.red}`,background:"transparent",padding:"3px 8px",cursor:"pointer",borderRadius:"2px",flexShrink:0}}>✕</button>
          </div>
        : <div onClick={()=>uploadRef.current?.click()}
            style={{border:`1px dashed ${C.border2}`,borderRadius:"3px",padding:"16px",background:C.bg3,cursor:"pointer",textAlign:"center",marginBottom:"8px"}}
            onMouseOver={e=>e.currentTarget.style.borderColor=C.gold} onMouseOut={e=>e.currentTarget.style.borderColor=C.border2}>
            <input ref={uploadRef} type="file" accept="audio/*" style={{display:"none"}} onChange={e=>handleUpload(e.target.files[0])}/>
            <div style={{fontSize:"1.8rem",opacity:0.35,marginBottom:"6px"}}>🎧</div>
            <div style={{fontFamily:mono,fontSize:"0.62rem",fontWeight:"700",color:C.text2,letterSpacing:"1px"}}>TAP TO UPLOAD SONG / SPEECH</div>
            <div style={{fontFamily:mono,fontSize:"0.5rem",color:C.text3,marginTop:"3px"}}>.mp3 / .wav — lip sync locks to this audio</div>
          </div>
      }

      {/* Optional transcribe button */}
      {audFile && (
        <button onClick={handleTranscribe} disabled={!apiKey||apiKey.length<10||transcribing} style={{
          width:"100%",padding:"7px",background:"transparent",
          border:`1px solid ${transcript?"#0a4a2a":C.border2}`,
          fontFamily:mono,fontSize:"0.52rem",letterSpacing:"2px",
          color:transcript?C.green:apiKey.length>10?C.text2:C.text3,
          cursor:apiKey.length>10&&!transcribing?"pointer":"not-allowed",borderRadius:"3px",
          display:"flex",alignItems:"center",justifyContent:"center",gap:"6px",marginBottom:"6px",
        }}>
          {transcribing?"⚡ TRANSCRIBING...":transcript?"✓ TRANSCRIBED — RE-TRANSCRIBE":"🎙 TRANSCRIBE AUDIO (OPTIONAL)"}
        </button>
      )}
      {txError && <div style={{fontFamily:mono,fontSize:"0.5rem",color:C.red,marginBottom:"6px"}}>✗ {txError}</div>}
    </div>
  );
}

// ── GENERATOR SCREEN ──────────────────────────────────────────
function Generator({ apiKey, onVideoReady }) {
  const [imgFile,    setImgFile]    = useState(null);
  const [imgUrl,     setImgUrl]     = useState("");
  const [audFile,    setAudFile]    = useState(null);
  const [audUrl,     setAudUrl]     = useState("");
  const [voiceFile,  setVoiceFile]  = useState(null);
  const [voiceUrl,   setVoiceUrl]   = useState("");
  const [perf,       setPerf]       = useState("RAPPING");
  const [lyrics,     setLyrics]     = useState("");
  const [transcript, setTranscript] = useState("");
  const [scene,      setScene]      = useState("");
  const [tags,       setTags]       = useState([]);
  const [camera,     setCamera]     = useState("SLOW ORBIT");
  const [style,      setStyle]      = useState("CINEMATIC");
  const [dur,        setDur]        = useState("4s");

  const [logs,       setLogs]       = useState([{ ts:"—", msg:"System ready — configure inputs and generate.", type:"ok" }]);
  const [running,    setRunning]    = useState(false);
  const [done,       setDone]       = useState(false);
  const [stagesDone, setStagesDone] = useState([]);
  const [activeStg,  setActiveStg]  = useState("");
  const [poll,       setPoll]       = useState(0);
  const [progress,   setProgress]   = useState(0);
  const [veoPrompt,  setVeoPrompt]  = useState("");
  const [videoUrl,   setVideoUrl]   = useState("");
  const [cutPoints,  setCutPoints]  = useState([]);
  const [brollClips, setBrollClips] = useState([]);

  const [hasError,   setHasError]   = useState(false);

  const logRef = useRef();
  useEffect(()=>{ if(logRef.current) logRef.current.scrollTop=logRef.current.scrollHeight; },[logs]);

  const ts  = () => { const d=new Date(); return `${String(d.getHours()).padStart(2,"0")}:${String(d.getMinutes()).padStart(2,"0")}:${String(d.getSeconds()).padStart(2,"0")}`; };
  const log = (msg, type="info") => setLogs(p=>[...p,{msg,type,ts:ts()}]);
  const canRun = apiKey.length>10 && imgFile && audFile && scene.trim().length>4;

  // 7.7 — on mount, check if a Veo job was left in-progress (e.g. page refresh during generation)
  useEffect(() => {
    const saved = localStorage.getItem("chadstudio_op");
    if (!saved || !apiKey) return;
    try {
      const { opName, durSecs } = JSON.parse(saved);
      if (!opName) return;
      setRunning(true);
      log("⚡ Resuming previous Veo job after page refresh...", "gold");
      pollVeo(apiKey, opName, count => {
        setPoll(count);
        setProgress(Math.min(50 + count * 0.55, 88));
        if (count % 8 === 0) log(`Still generating... poll ${count}/80`, "info");
      }).then(vidUri => {
        localStorage.removeItem("chadstudio_op");
        setVideoUrl(vidUri);
        setStagesDone(["ingest","transcribe","prompt","generate"]);
        setProgress(90); setRunning(false);
        log("✓ Resumed video ready — continuing pipeline...", "ok");
      }).catch(err => {
        localStorage.removeItem("chadstudio_op");
        log(`✗ Resume failed — ${err.message}`, "err");
        setRunning(false); setHasError(true);
      });
    } catch(e) { localStorage.removeItem("chadstudio_op"); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGen = async () => {
    if (!canRun||running) return;
    setRunning(true); setDone(false); setHasError(false); setLogs([]); setVeoPrompt(""); setVideoUrl("");
    setStagesDone([]); setPoll(0); setProgress(0); setCutPoints([]); setBrollClips([]);

    try {
      // ── 1. INGEST
      setActiveStg("ingest"); setProgress(5);
      log("Reading files into memory...","info");
      const imgB64  = imgUrl.startsWith("data:") ? imgUrl.split(",")[1] : await readB64(imgFile);
      const imgMime = imgFile.type||"image/png";
      setStagesDone(p=>[...p,"ingest"]); setProgress(14);
      log("✓ Assets loaded","ok");

      // ── 2. TRANSCRIBE — use lyrics if provided, else skip
      let txText = lyrics.trim();
      if (txText.length > 5) {
        setStagesDone(p=>[...p,"transcribe"]); setProgress(28);
        log(`✓ Using provided lyrics (${txText.split(" ").length} words)`,"ok");
      } else {
        setActiveStg("transcribe"); setProgress(18);
        log("No lyrics — using scene description for prompt...","gold");
        txText = scene.trim();
        setStagesDone(p=>[...p,"transcribe"]); setProgress(28);
        log("✓ Scene-only mode — skipping transcription","ok");
      }

      // ── 3. BUILD VEO PROMPT
      setActiveStg("prompt"); setProgress(36);
      log("Building Veo 3.1 Fast prompt with Gemini...","gold");

      // Voice DNA — send actual audio to Gemini for vocal analysis
      let voiceNote = "";
      if (voiceFile) {
        try {
          log("Analysing Voice DNA with Gemini...","gold");
          const voiceB64  = voiceUrl.startsWith("data:") ? voiceUrl.split(",")[1] : await readB64(voiceFile);
          const voiceMime = voiceFile.type || "audio/mpeg";
          const dnaRaw = await callGemini(
            apiKey,
            `Listen to this vocal sample. In ONE concise sentence (max 80 chars), describe the artist's unique vocal style: tone, pace, energy, delivery. No labels, no preamble.`,
            voiceB64, voiceMime
          );
          if (dnaRaw && dnaRaw.trim().length > 5) {
            voiceNote = `Artist vocal style: ${dnaRaw.trim().slice(0, 100)}`;
            log(`✓ Voice DNA analysed — ${dnaRaw.trim().slice(0, 60)}...`, "ok");
          }
        } catch(dnaErr) {
          log(`⚠ Voice DNA analysis skipped — ${dnaErr.message}`, "gold");
          voiceNote = "Voice DNA sample provided — match this artist's unique vocal tone and cadence.";
        }
      }

      const builtP = await callGemini(
        apiKey,
        `You are a Veo 3.1 Fast video prompt engineer. Write ONE powerful cinematic prompt under 350 characters.
Return ONLY the prompt — no quotes, no labels, no preamble.

Details:
Performance: ${perf}
Scene: ${scene}
Tags: ${tags.join(", ")||"none"}
Camera: ${camera}
Style: ${style}
${txText.length>10?`Lyrics/words artist performs: ${txText.slice(0,200)}`:""}
${voiceNote}

Rules: subject in image lip-syncs naturally, include camera motion, lighting, mood. Max 350 chars.`,
        null, null
      );
      if (!builtP||builtP.trim().length<10) throw new Error("Prompt builder returned empty — check API key.");
      setVeoPrompt(builtP.trim());
      setStagesDone(p=>[...p,"prompt"]); setProgress(45);
      log(`✓ Veo prompt ready (${builtP.trim().length} chars)`,"ok");

      // ── 4. VEO GENERATION
      setActiveStg("generate"); setProgress(50);
      log("Submitting to Veo 3.1 Fast — starting long-running job...","gold");
      // Fix 1.5 — parse duration string (e.g. "30s") to integer before passing to Veo
      const durSecs = parseInt(dur, 10) || 8;
      log(`● Duration: ${durSecs}s${voiceFile ? " · Voice DNA active" : ""}`, "gold");
      const opName = await startVeo(apiKey, builtP.trim(), imgB64, imgMime, durSecs);
      localStorage.setItem("chadstudio_op", JSON.stringify({ opName, durSecs })); // 7.7
      log("✓ Job accepted — polling every 5s (2–6 min)...","ok");

      const vidUri = await pollVeo(apiKey, opName,
        count => {
          setPoll(count);
          setProgress(Math.min(50 + count * 0.55, 88));
          if (count % 8 === 0) log(`Still generating... poll ${count}/80`,"info");
        },
        msg => log(`⏳ ${msg}`, "gold") // 7.8 rate limit countdown
      );
      localStorage.removeItem("chadstudio_op"); // 7.7 — job done, clear resume key

      setVideoUrl(vidUri);
      setStagesDone(p=>[...p,"generate"]); setProgress(90);
      log("✓ Video generated — starting sync analysis...", "ok");

      // ── 5. SYNC ANALYSIS (Phase 2 — real Gemini video analysis)
      setActiveStg("sync");
      log("Sending video to Gemini 2.5 Flash for sync analysis...", "gold");
      let cutPts = [];
      try {
        const syncPrompt = `You are a video sync analyser. The video shows a person performing/lip-syncing.
The lyrics/words being performed are: "${txText.slice(0, 400)}".
Watch the video carefully and identify every timestamp where the lip sync breaks badly — mouth movements don't match the audio, held notes with incorrect mouth shape, or fast sections that drift.
Return ONLY a JSON array like: [{"t":2.4,"reason":"held note"},{"t":5.1,"reason":"fast section"}]
If you detect no sync breaks, return: []
No explanation. No markdown. No backticks. JSON only.`;

        const syncRaw = await callGeminiVideo(apiKey, vidUri, syncPrompt);
        // Strip any markdown fences Gemini might add despite instructions
        const syncClean = syncRaw.replace(/```json|```/g, "").trim();
        cutPts = JSON.parse(syncClean);
        if (!Array.isArray(cutPts)) cutPts = [];
        setCutPoints(cutPts);

        if (cutPts.length === 0) {
          log("✓ Sync analysis complete — no sync breaks detected", "ok");
        } else {
          log(`✓ Sync analysis complete — ${cutPts.length} cut point${cutPts.length>1?"s":""} found`, "ok");
          cutPts.forEach(p => log(`  ↳ ${p.t.toFixed(1)}s — ${p.reason}`, "gold"));
        }
        setStagesDone(p=>[...p,"sync"]);
      } catch(syncErr) {
        log(`⚠ Sync analysis skipped — ${syncErr.message}`, "gold");
        setStagesDone(p=>[...p,"sync"]);
      }

      setProgress(96);

      // ── 6. B-ROLL GENERATION (Phase 3 — generate clips at each cut point)
      setActiveStg("broll");
      let brollResults = [];

      if (cutPts.length === 0) {
        log("● No sync breaks — skipping B-roll generation", "gold");
        setStagesDone(p=>[...p,"broll"]);
      } else {
        log(`Generating ${cutPts.length} B-roll clip${cutPts.length>1?"s":""} — sequential to avoid rate limits...`, "gold");
        for (let ci = 0; ci < cutPts.length; ci++) {
          const cp = cutPts[ci];
          log(`Generating B-roll ${ci+1}/${cutPts.length} at ${cp.t.toFixed(1)}s...`, "gold");
          try {
            // 3.2 — Gemini builds scene-only B-roll prompt (no face)
            const brollDescPrompt = `You are a Veo 3.1 Fast video prompt engineer.
Write a SHORT cinematic B-roll shot description (max 200 chars) for this moment in a music video.
Scene context: ${scene}
Visual style: ${style}
Cut reason: ${cp.reason} at ${cp.t.toFixed(1)}s
Rules: NO people, NO faces, NO lip sync. Scene-only cutaway. Cinematic, matches main video mood.
Return ONLY the shot description — no quotes, no labels.`;

            const brollDesc = await callGemini(apiKey, brollDescPrompt, null, null);
            const brollPrompt = brollDesc.trim().slice(0, 200) || `Cinematic cutaway ${scene} — ${style}`;
            log(`  ↳ Prompt: ${brollPrompt.slice(0, 60)}...`, "info");

            // 3.3 — Call Veo for this B-roll clip (5s, no person generation needed)
            const brollOp = await startVeo(apiKey, brollPrompt, imgB64, imgMime, 5);
            const brollUri = await pollVeo(apiKey, brollOp, count => {
              if (count % 6 === 0) log(`  ↳ B-roll ${ci+1} poll ${count}/80...`, "info");
            });

            const clip = { timestamp: cp.t, videoUrl: brollUri, duration: 5, prompt: brollPrompt, reason: cp.reason };
            brollResults.push(clip);
            setBrollClips(prev => [...prev, clip]);
            log(`  ✓ B-roll ${ci+1}/${cutPts.length} ready at ${cp.t.toFixed(1)}s`, "ok");
          } catch(brollErr) {
            log(`  ⚠ B-roll ${ci+1} failed — ${brollErr.message}`, "gold");
            // Non-fatal — continue to next clip
          }
        }
        setStagesDone(p=>[...p,"broll"]);
        log(`✓ B-roll complete — ${brollResults.length}/${cutPts.length} clips generated`, "ok");
      }

      setStagesDone(p=>[...p,"compose","ready"]);
      setActiveStg("ready"); setProgress(100);
      log("✓✓ PIPELINE COMPLETE — OPENING ADVANCED STUDIO", "ok");
      setDone(true);

      // 6.13 — log generation to Supabase
      supabase.auth.getUser().then(({ data: { user } }) => {
        if (user) supabase.from("generations").insert({
          user_id:         user.id,
          output_url:      vidUri,
          service:         "veo",
          prompt_snapshot: builtP.trim().slice(0, 500),
        });
      });

      setTimeout(()=>{
        onVideoReady({
          videoUrl: vidUri,
          veoPrompt: builtP.trim(),
          audioFile: audFile,
          audioDataUrl: audUrl,
          imageDataUrl: imgUrl,
          transcript: txText,
          cutPoints: cutPts,           // Phase 2 — sync break timestamps
          brollClips: brollResults,    // Phase 3 — generated B-roll clips
          duration: durSecs,           // actual generated duration
        });
      }, 1000);

    } catch(err) {
      localStorage.removeItem("chadstudio_op"); // 7.7
      log(`✗ ERROR: ${err.message}`,"err");
      setActiveStg("");
      setHasError(true); // 7.6
    } finally {
      setRunning(false);
    }
  };

  const isMobile = useIsMobile();

  return (
    <div style={{flex:1,display:"grid",gridTemplateColumns:isMobile?"1fr":"300px 1fr",gridTemplateRows:isMobile?"auto 1fr":"1fr",overflow:"hidden",minHeight:0}}>

      {/* ── LEFT PANEL ── */}
      <div style={{borderRight:isMobile?"none":`1px solid ${C.border}`,borderBottom:isMobile?`1px solid ${C.border}`:"none",overflowY:"auto",maxHeight:isMobile?"50vh":"none"}}>
        <div style={{padding:"14px",display:"flex",flexDirection:"column",gap:"18px"}}>

          {/* 01 IMAGE WORKSHOP */}
          <ImageWorkshop apiKey={apiKey} imgFile={imgFile} imgUrl={imgUrl} setImgFile={setImgFile} setImgUrl={setImgUrl}/>

          {/* 02 AUDIO TRACK */}
          <AudioSection apiKey={apiKey} audFile={audFile} audUrl={audUrl} setAudFile={setAudFile} setAudUrl={setAudUrl}
            lyrics={lyrics} setLyrics={setLyrics} transcript={transcript} setTranscript={setTranscript}/>

          {/* 03 VOICE DNA */}
          <div>
            <SecHead n="03" title="Voice DNA" sub="Optional — 30s min voice sample"/>
            {voiceFile
              ? <div style={{display:"flex",alignItems:"center",gap:"10px",background:C.bg3,border:`1px solid ${C.green}`,borderRadius:"3px",padding:"10px"}}>
                  <div style={{fontSize:"1.2rem"}}>🎤</div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontFamily:mono,fontSize:"0.58rem",color:C.green}}>✓ {voiceFile.name.length>24?voiceFile.name.slice(0,21)+"…":voiceFile.name}</div>
                    <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,marginTop:"2px"}}>{fmtSize(voiceFile.size)}</div>
                  </div>
                  <button onClick={()=>{setVoiceFile(null);setVoiceUrl("");}} style={{fontFamily:mono,fontSize:"0.46rem",color:C.red,border:`1px solid ${C.red}`,background:"transparent",padding:"3px 8px",cursor:"pointer",borderRadius:"2px"}}>✕</button>
                </div>
              : <div onClick={()=>document.getElementById("voiceInput").click()}
                  style={{border:`1px dashed ${C.border2}`,borderRadius:"3px",padding:"14px",background:C.bg3,cursor:"pointer",textAlign:"center"}}
                  onMouseOver={e=>e.currentTarget.style.borderColor=C.gold} onMouseOut={e=>e.currentTarget.style.borderColor=C.border2}>
                  <input id="voiceInput" type="file" accept="audio/*" style={{display:"none"}} onChange={e=>{if(e.target.files[0]){readDataUrl(e.target.files[0]).then(u=>{setVoiceFile(e.target.files[0]);setVoiceUrl(u);});}}}/>
                  <div style={{fontSize:"1.6rem",opacity:0.3,marginBottom:"5px"}}>🎤</div>
                  <div style={{fontFamily:mono,fontSize:"0.6rem",fontWeight:"700",color:C.text2,letterSpacing:"1px"}}>TAP TO UPLOAD VOICE SAMPLE</div>
                  <div style={{fontFamily:mono,fontSize:"0.5rem",color:C.text3,marginTop:"3px"}}>Builds pitch + cadence model for DNA</div>
                </div>
            }
          </div>

          {/* 04 PERFORMANCE */}
          <div>
            <SecHead n="04" title="Performance" sub="Type — optional lyrics improve lip sync"/>
            <div style={{marginBottom:"8px"}}><Pills opts={PERF_TYPES} val={perf} set={setPerf}/></div>
            <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,letterSpacing:"1px",marginBottom:"5px"}}>LYRICS / SCRIPT — OPTIONAL (OR AUTO-TRANSCRIBE ABOVE)</div>
            <textarea value={lyrics} onChange={e=>setLyrics(e.target.value)}
              placeholder={"Paste lyrics here, or use the transcribe\nbutton in Step 02 to auto-fill..."}
              maxLength={600}
              style={{width:"100%",boxSizing:"border-box",background:C.bg3,border:`1px solid ${lyrics.length>5?C.border2:C.border}`,borderRadius:"3px",padding:"8px 10px",fontFamily:mono,fontSize:"0.55rem",color:C.text2,lineHeight:1.7,resize:"vertical",minHeight:"60px",outline:"none"}}/>
            {transcript && <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.green,marginTop:"4px"}}>✓ Auto-filled from transcription — edit above if needed</div>}
          </div>

          {/* 05 SCENE */}
          <div>
            <SecHead n="05" title="Scene Prompt" sub="Where is the artist performing?"/>
            <textarea value={scene} onChange={e=>setScene(e.target.value)}
              placeholder={"Artist rapping on rooftop at sunset,\ncity skyline behind them..."}
              maxLength={300}
              style={{width:"100%",boxSizing:"border-box",background:C.bg3,border:`1px solid ${scene.length>4?C.border2:C.border}`,borderRadius:"3px",padding:"8px 10px",fontFamily:mono,fontSize:"0.55rem",color:C.text2,lineHeight:1.7,resize:"vertical",minHeight:"70px",outline:"none"}}/>
            <div style={{fontFamily:mono,fontSize:"0.43rem",color:C.text3,textAlign:"right",marginTop:"2px"}}>{scene.length}/300</div>
            <div style={{marginTop:"7px"}}><Pills opts={SCENE_TAGS} val={tags} set={setTags} multi/></div>
          </div>

          {/* 06 CAMERA + STYLE */}
          <div>
            <SecHead n="06" title="Camera + Style"/>
            <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,letterSpacing:"1px",marginBottom:"5px"}}>CAMERA</div>
            <div style={{marginBottom:"10px"}}><Pills opts={CAMERAS} val={camera} set={setCamera}/></div>
            <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,letterSpacing:"1px",marginBottom:"5px"}}>STYLE</div>
            <Pills opts={STYLES} val={style} set={setStyle}/>
          </div>

          {/* 07 DURATION */}
          <div>
            <SecHead n="07" title="Duration"/>
            <Pills opts={DURATIONS} val={dur} set={setDur}/>
          </div>

          {/* GENERATE BUTTON */}
          <button onClick={handleGen} disabled={!canRun||running} style={{
            width:"100%", padding:"15px",
            background: done?C.green : canRun?C.gold : C.bg3,
            border: `1px solid ${done?C.green:canRun?C.gold:C.border}`,
            color: canRun ? C.bg : C.text3,
            fontFamily:mono, fontWeight:"700", fontSize:"0.72rem", letterSpacing:"3px", textTransform:"uppercase",
            cursor: canRun&&!running ? "pointer" : "not-allowed", borderRadius:"3px", transition:"all 0.2s",
          }}>
            {running ? `● GENERATING${poll>0?` — POLL ${poll}/80`:""}...` : done ? "✓ VIDEO READY — OPEN STUDIO →" : "▶ GENERATE VIDEO"}
          </button>

          {/* 7.6 — retry button shown after error */}
          {hasError && !running && (
            <button onClick={handleGen} disabled={!canRun} style={{
              width:"100%", padding:"10px", marginTop:"8px",
              background:"transparent", border:`1px solid ${C.red}`, color:C.red,
              fontFamily:mono, fontWeight:"700", fontSize:"0.62rem", letterSpacing:"2px",
              cursor:canRun?"pointer":"not-allowed", borderRadius:"3px",
            }}>
              ↺ RETRY — inputs preserved
            </button>
          )}

          <div style={{height:"20px"}}/>
        </div>
      </div>

      {/* ── RIGHT PANEL ── */}
      <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>

        {/* PIPELINE GRID */}
        <div style={{borderBottom:`1px solid ${C.border}`,padding:"12px 16px",flexShrink:0}}>
          <div style={{fontFamily:mono,fontSize:"0.52rem",letterSpacing:"3px",color:C.gold,marginBottom:"10px"}}>REAL PIPELINE — GOOGLE AI MODELS</div>
          <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:"6px",marginBottom:"6px"}}>
            {PIPELINE_STAGES.slice(0,4).map(p => {
              const isDone = stagesDone.includes(p.id);
              const isAct  = activeStg===p.id && running;
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
            {PIPELINE_STAGES.slice(4).map(p => {
              const isDone = stagesDone.includes(p.id);
              const isAct  = activeStg===p.id && running;
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
          {(running||progress>0) && (
            <div style={{marginTop:"6px",height:"3px",background:C.border,borderRadius:"2px",overflow:"hidden"}}>
              <div style={{height:"100%",width:`${progress}%`,background:progress===100?C.green:C.gold,transition:"width 0.5s",borderRadius:"2px"}}/>
            </div>
          )}
        </div>

        {/* VEO PROMPT RESULT */}
        {veoPrompt && (
          <div style={{borderBottom:`1px solid ${C.border}`,padding:"10px 16px",flexShrink:0}}>
            <div style={{fontFamily:mono,fontSize:"0.44rem",letterSpacing:"2px",color:C.gold,marginBottom:"5px"}}>✓ VEO PROMPT BUILT</div>
            <div style={{background:C.bg3,border:`1px solid rgba(212,168,67,0.2)`,borderRadius:"3px",padding:"8px 10px",fontFamily:mono,fontSize:"0.55rem",color:C.gold,lineHeight:1.7}}>{veoPrompt}</div>
          </div>
        )}

        {/* SYSTEM LOG */}
        <div style={{flex:1,padding:"12px 16px",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{fontFamily:mono,fontSize:"0.52rem",letterSpacing:"3px",color:C.gold,marginBottom:"8px"}}>SYSTEM LOG</div>
          <div ref={logRef} style={{flex:1,background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"3px",padding:"10px",overflowY:"auto",display:"flex",flexDirection:"column",gap:"2px"}}>
            {logs.map((l,i)=>(
              <div key={i} style={{display:"flex",gap:"10px",fontFamily:mono,fontSize:"0.52rem",lineHeight:1.6}}>
                <span style={{color:C.text3,flexShrink:0,minWidth:"50px"}}>{l.ts}</span>
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
function AdvancedStudio({ studioData, apiKey }) {
  const [extendPrompt, setExtendPrompt] = useState("");
  const [extending,    setExtending]    = useState(false);
  const [extendClips,  setExtendClips]  = useState([]);
  const [activeTab,   setActiveTab]   = useState("CLIPS");
  const [playing,     setPlaying]     = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration,    setDuration]    = useState(30);
  const [volume,      setVolume]      = useState(80);
  const [zoom,        setZoom]        = useState(100);
  const [exporting,   setExporting]   = useState(false);
  const [exportPct,   setExportPct]   = useState(0);

  const videoRef   = useRef();
  const audioCtxRef = useRef(null);  // Phase 4.2 — Web Audio context
  const gainRef    = useRef(null);   // Phase 4.4 — GainNode for volume
  const audBufRef  = useRef(null);   // decoded AudioBuffer of original song
  const audSrcRef  = useRef(null);   // current AudioBufferSourceNode
  const audStartRef = useRef(0);     // audioCtx time when play started
  const audOffRef  = useRef(0);      // offset into buffer when play started
  const hasVideo   = !!studioData?.videoUrl;

  // Phase 4.1 — mute Veo's generated audio on load; decode original song
  useEffect(() => {
    const v = videoRef.current; if (!v) return;
    v.muted = true;  // 4.1: silence Veo's audio — original song plays via Web Audio
    const onTime = () => setCurrentTime(v.currentTime);
    const onMeta = () => setDuration(v.duration || 30);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("loadedmetadata", onMeta);

    // 4.2 — create AudioContext and GainNode
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const gain = ctx.createGain();
    gain.gain.value = volume / 100;
    gain.connect(ctx.destination);
    audioCtxRef.current = ctx;
    gainRef.current = gain;

    // Decode original audio file if available
    if (studioData?.audioFile) {
      studioData.audioFile.arrayBuffer().then(ab => {
        ctx.decodeAudioData(ab).then(buf => { audBufRef.current = buf; });
      }).catch(() => {});
    } else if (studioData?.audioDataUrl) {
      // Fallback: decode from data URL
      const b64 = studioData.audioDataUrl.split(",")[1];
      const bin = atob(b64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      ctx.decodeAudioData(bytes.buffer).then(buf => { audBufRef.current = buf; }).catch(() => {});
    }

    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("loadedmetadata", onMeta);
      ctx.close();
    };
  }, [studioData]);

  // 4.4 — keep gainNode synced with volume slider
  useEffect(() => {
    if (gainRef.current) gainRef.current.gain.value = volume / 100;
    if (videoRef.current) videoRef.current.volume = 0; // always keep video muted
  }, [volume]);

  // Phase 4.3 — start/stop original audio in sync with video
  const startAudio = (offsetSecs) => {
    const ctx = audioCtxRef.current;
    const buf = audBufRef.current;
    const gain = gainRef.current;
    if (!ctx || !buf || !gain) return;
    // Stop any existing source
    try { audSrcRef.current?.stop(); } catch(e) {}
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(gain);
    src.start(0, Math.max(0, offsetSecs));
    audSrcRef.current = src;
    audStartRef.current = ctx.currentTime;
    audOffRef.current = offsetSecs;
  };

  const stopAudio = () => {
    try { audSrcRef.current?.stop(); } catch(e) {}
    audSrcRef.current = null;
  };

  // 4.3 — togglePlay syncs both video and original audio
  const togglePlay = () => {
    const v = videoRef.current; if (!v) return;
    if (playing) {
      v.pause();
      stopAudio();
    } else {
      v.play();
      startAudio(v.currentTime);
    }
    setPlaying(!playing);
  };

  // 4.3 — seek syncs audio offset
  const skipTo = (t) => {
    const v = videoRef.current; if (!v) return;
    const clamped = Math.max(0, Math.min(t, duration));
    v.currentTime = clamped;
    setCurrentTime(clamped);
    if (playing) startAudio(clamped); // restart audio at new position
  };

  // Phase 4.5-4.10 — Export: MediaRecorder + canvas for video+audio mux
  const handleExport = async () => {
    const v = videoRef.current;
    const buf = audBufRef.current;
    if (!v || !hasVideo) return;
    setExporting(true); setExportPct(5);

    try {
      // Option A: MediaRecorder on canvas + audio
      const canvas = document.createElement("canvas");
      canvas.width  = v.videoWidth  || 720;
      canvas.height = v.videoHeight || 1280;
      const ctx2d  = canvas.getContext("2d");
      const vidStream = canvas.captureStream(30);

      // If we have a decoded audio buffer, route through MediaRecorder audio
      const exportCtx  = new (window.AudioContext || window.webkitAudioContext)();
      const exportDest = exportCtx.createMediaStreamDestination();
      const exportGain = exportCtx.createGain();
      exportGain.gain.value = 1;
      exportGain.connect(exportDest);

      if (buf) {
        const src = exportCtx.createBufferSource();
        src.buffer = buf;
        src.connect(exportGain);
        src.start(0);
      }

      const combinedStream = new MediaStream([
        ...vidStream.getVideoTracks(),
        ...(buf ? exportDest.stream.getAudioTracks() : [])
      ]);

      const recorder = new MediaRecorder(combinedStream, { mimeType: "video/webm;codecs=vp9,opus" });
      const chunks = [];
      recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };

      recorder.start(100);
      v.currentTime = 0;
      v.play();

      setExportPct(15);
      const vidDuration = duration * 1000;
      const drawInterval = setInterval(() => {
        try { ctx2d.drawImage(v, 0, 0, canvas.width, canvas.height); } catch(e) {}
        const elapsed = v.currentTime / duration;
        setExportPct(Math.min(15 + Math.round(elapsed * 75), 90));
      }, 33); // ~30fps

      await new Promise(resolve => {
        v.onended = resolve;
        setTimeout(resolve, vidDuration + 500);
      });

      clearInterval(drawInterval);
      recorder.stop();
      await exportCtx.close();
      v.pause(); v.currentTime = 0;
      setPlaying(false);
      setExportPct(95);

      await new Promise(r => { recorder.onstop = r; setTimeout(r, 1000); });
      const blob = new Blob(chunks, { type: "video/webm" });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement("a");
      a.href = url; a.download = "chadstudio-export.webm"; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
      setExportPct(100);
      setTimeout(() => { setExporting(false); setExportPct(0); }, 2000);
    } catch(exportErr) {
      // Fallback: separate video + audio download
      const va = document.createElement("a"); va.href = studioData.videoUrl;
      va.download = "chadstudio-video.mp4"; va.click();
      if (studioData?.audioDataUrl) {
        setTimeout(() => {
          const aa = document.createElement("a"); aa.href = studioData.audioDataUrl;
          aa.download = "chadstudio-audio.mp3"; aa.click();
        }, 500);
      }
      setExporting(false); setExportPct(0);
    }
  };

  // ── Phase 5 — Timeline Interactivity ──────────────────────────
  const [mutedTracks,  setMutedTracks]  = useState(new Set());
  const [activeFilter, setActiveFilter] = useState("");
  const [manualCuts,   setManualCuts]   = useState([]);
  const [aspectRatio,  setAspectRatio]  = useState("9:16");
  const [clipOffsets,  setClipOffsets]  = useState({}); // 5.3 — drag-repositioned clip start times
  const [trimPoints,   setTrimPoints]   = useState({}); // 5.5 — per-clip trim in/out (secs from clip start)
  const scrubbing  = useRef(false);
  const timelineRef = useRef();

  // 5.1 — ruler click seeks to clicked time position
  const handleRulerClick = (e) => {
    const rect = e.currentTarget.getBoundingClientRect();
    skipTo((e.clientX - rect.left) / pxPerSec);
  };

  // 5.2 — playhead drag scrub via pointer events (works for mouse + touch)
  const handlePlayheadMouseDown = (e) => {
    e.preventDefault();
    scrubbing.current = true;
    const onMove = (mv) => {
      if (!scrubbing.current) return;
      const tl = timelineRef.current; if (!tl) return;
      const rect = tl.getBoundingClientRect();
      skipTo(Math.max(0, (mv.clientX - rect.left + tl.scrollLeft) / pxPerSec));
    };
    const onUp = () => { scrubbing.current = false; window.removeEventListener("pointermove",onMove); window.removeEventListener("pointerup",onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 5.4 / 5.6 — CUT at playhead — adds manual cut marker on timeline
  const handleCut = () => {
    if (!hasVideo) return;
    const t = parseFloat(currentTime.toFixed(2));
    setManualCuts(prev => prev.some(c => Math.abs(c - t) < 0.2) ? prev : [...prev, t].sort((a,b)=>a-b));
  };

  // 5.3 — clip drag: returns onPointerDown handler for a given clip
  const makeClipDragHandler = (clipId, originalStart) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX   = e.clientX;
    const startPos = clipOffsets[clipId] ?? originalStart;
    const onMove = (mv) => {
      const newStart = Math.max(0, startPos + (mv.clientX - startX) / pxPerSec);
      setClipOffsets(prev => ({ ...prev, [clipId]: newStart }));
    };
    const onUp = () => { window.removeEventListener("pointermove",onMove); window.removeEventListener("pointerup",onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 5.5 — trim: returns onPointerDown handler for a trim handle (side = "in" | "out")
  const makeTrimHandler = (clipId, side, clipDur) => (e) => {
    e.preventDefault(); e.stopPropagation();
    const startX  = e.clientX;
    const current = trimPoints[clipId] || { in: 0, out: clipDur };
    const onMove  = (mv) => {
      const delta = (mv.clientX - startX) / pxPerSec;
      setTrimPoints(prev => {
        const cur = prev[clipId] || { in: 0, out: clipDur };
        if (side === "in")  return { ...prev, [clipId]: { ...cur, in:  Math.max(0,           Math.min(cur.in  + delta, cur.out - 0.5)) } };
        if (side === "out") return { ...prev, [clipId]: { ...cur, out: Math.max(cur.in + 0.5, Math.min(cur.out + delta, clipDur      )) } };
        return prev;
      });
    };
    const onUp = () => { window.removeEventListener("pointermove",onMove); window.removeEventListener("pointerup",onUp); };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // 5.7 — track mute toggle
  const toggleTrackMute = (trackId) => {
    setMutedTracks(prev => {
      const next = new Set(prev);
      if (next.has(trackId)) {
        next.delete(trackId);
        if (trackId==="audio" && gainRef.current) gainRef.current.gain.value = volume/100;
      } else {
        next.add(trackId);
        if (trackId==="audio" && gainRef.current) gainRef.current.gain.value = 0;
      }
      return next;
    });
  };

  // 5.8 — FX filter presets
  const FX_FILTERS = {
    "FILM GRAIN":  "contrast(1.1) brightness(0.95) saturate(0.85)",
    "COLOR GRADE": "saturate(1.4) hue-rotate(10deg)",
    "LENS FLARE":  "contrast(1.05) brightness(1.1)",
    "VIGNETTE":    "contrast(1.15) brightness(0.9)",
    "GLOW":        "brightness(1.15)",
    "SHARPEN":     "contrast(1.2) saturate(1.1)",
  };

  const TABS   = ["CLIPS","FX","EXTEND","AUDIO"];
  const TRACKS = [
    {id:"video",  icon:"🎬", label:"VIDEO"},
    {id:"audio",  icon:"🎵", label:"ORIG AUDIO"},
    {id:"broll",  icon:"🎥", label:"B-ROLL"},
    {id:"effects",icon:"✨", label:"EFFECTS"},
  ];

  const pxPerSec = 60 * (zoom/100);
  const totalW   = Math.max(duration * pxPerSec, 600);

  const Btn = ({children, onClick, active}) => (
    <button onClick={onClick} style={{width:"30px",height:"30px",background:active?C.bg4:C.bg3,border:`1px solid ${active?C.border2:C.border}`,color:C.text2,cursor:"pointer",borderRadius:"3px",fontSize:"0.8rem",fontFamily:mono,flexShrink:0}}>{children}</button>
  );

  const isMobile = useIsMobile();

  return (
    <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      <div style={{flex:1,display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 340px",gridTemplateRows:isMobile?"1fr auto":"1fr",overflow:isMobile?"auto":"hidden",minHeight:0}}>

        {/* VIDEO PLAYER */}
        <div style={{borderRight:isMobile?"none":`1px solid ${C.border}`,borderBottom:isMobile?`1px solid ${C.border}`:"none",display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{flex:1,background:"#000",display:"flex",alignItems:"center",justifyContent:"center",position:"relative",minHeight:0,overflow:"hidden"}}>
            {hasVideo
              ? <video ref={videoRef} src={studioData.videoUrl}
                  style={{maxWidth:"100%",objectFit:"contain",
                    // 5.9 aspect ratio constraints
                    aspectRatio: aspectRatio==="9:16" ? "9/16" : "16/9",
                    maxHeight: aspectRatio==="9:16" ? "100%" : "auto",
                    // 5.8 CSS filter from FX tab
                    filter: activeFilter || "none",
                  }} loop/>
              : <div style={{textAlign:"center"}}>
                  <div style={{fontSize:"3rem",opacity:0.1,marginBottom:"10px"}}>▶</div>
                  <div style={{fontFamily:mono,fontSize:"0.55rem",color:C.text3,letterSpacing:"2px"}}>Generate a video first</div>
                </div>
            }
          </div>

          {/* PLAYBACK CONTROLS */}
          <div style={{padding:"8px 14px",borderTop:`1px solid ${C.border}`,background:C.bg2,display:"flex",alignItems:"center",gap:"6px",flexShrink:0,flexWrap:"wrap"}}>
            <Btn onClick={()=>skipTo(0)}>⏮</Btn>
            <Btn onClick={togglePlay} active>{playing?"⏸":"▶"}</Btn>
            <Btn onClick={()=>skipTo(currentTime+5)}>⏩</Btn>
            <Btn onClick={()=>skipTo(duration)}>⏭</Btn>
            <div style={{fontFamily:mono,fontSize:"0.62rem",color:C.gold,marginLeft:"4px",minWidth:"92px"}}>{fmtTime(currentTime)} / {fmtTime(duration)}</div>
            <div style={{flex:1}}/>
            <span style={{fontSize:"0.9rem",opacity:0.5}}>🔊</span>
            <input type="range" min={0} max={100} value={volume} onChange={e=>setVolume(+e.target.value)} style={{width:"80px",accentColor:C.gold}}/>
            <span style={{fontFamily:mono,fontSize:"0.5rem",color:C.text3}}>{volume}%</span>
            <Btn onClick={()=>setZoom(z=>Math.max(25,z-25))}>−</Btn>
            <span style={{fontFamily:mono,fontSize:"0.5rem",color:C.text3,minWidth:"36px",textAlign:"center"}}>{zoom}%</span>
            <Btn onClick={()=>setZoom(z=>Math.min(300,z+25))}>+</Btn>
          </div>
        </div>

        {/* RIGHT TABS */}
        <div style={{display:"flex",flexDirection:"column",overflow:"hidden"}}>
          <div style={{display:"flex",borderBottom:`1px solid ${C.border}`,flexShrink:0}}>
            {TABS.map(t=>(
              <button key={t} onClick={()=>setActiveTab(t)} style={{
                flex:1,padding:"10px 4px",fontFamily:mono,fontSize:"0.5rem",letterSpacing:"1px",fontWeight:"700",
                border:"none",borderBottom:`2px solid ${activeTab===t?C.gold:"transparent"}`,
                background:"transparent",color:activeTab===t?C.gold:C.text3,cursor:"pointer",
              }}>
                {t==="CLIPS"?"🎬 ":t==="FX"?"✨ ":t==="EXTEND"?"⚡ ":"🎵 "}{t}
              </button>
            ))}
          </div>

          <div style={{flex:1,padding:"14px",overflowY:"auto"}}>
            {activeTab==="CLIPS" && (() => {
              const brolls = studioData?.brollClips || [];
              const dur    = studioData?.duration || 8;
              return (
                <>
                  <div style={{fontFamily:mono,fontSize:"0.5rem",letterSpacing:"2px",color:C.text2,marginBottom:"10px"}}>GENERATED CLIPS — {hasVideo?`${1+brolls.length+extendClips.length} TOTAL`:"NONE"}</div>
                  {hasVideo
                    ? <div style={{display:"flex",flexDirection:"column",gap:"6px"}}>
                        {/* Main performance clip */}
                        <div style={{background:C.bg3,border:`1px solid ${C.green}`,borderRadius:"3px",padding:"10px",display:"flex",gap:"10px",alignItems:"center"}}>
                          <div style={{fontSize:"1.2rem"}}>🎬</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontFamily:mono,fontSize:"0.58rem",color:C.green,fontWeight:"700"}}>✓ Main Performance</div>
                            <div style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,marginTop:"2px"}}>Veo 3.1 Fast · {dur}s · 9:16 · 0.0s</div>
                          </div>
                        </div>
                        {/* B-roll clips from Phase 3 */}
                        {brolls.map((cl,i) => (
                          <div key={i} style={{background:C.bg3,border:`1px solid rgba(212,168,67,0.4)`,borderRadius:"3px",padding:"10px",display:"flex",gap:"10px",alignItems:"flex-start"}}>
                            <div style={{fontSize:"1.1rem",marginTop:"1px"}}>🎥</div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontFamily:mono,fontSize:"0.56rem",color:C.gold,fontWeight:"700"}}>B-Roll {i+1} · at {cl.timestamp.toFixed(1)}s</div>
                              <div style={{fontFamily:mono,fontSize:"0.44rem",color:C.text3,marginTop:"2px"}}>{cl.duration}s · {cl.reason}</div>
                              <div style={{fontFamily:mono,fontSize:"0.42rem",color:C.text3,marginTop:"2px",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{cl.prompt.slice(0,50)}...</div>
                            </div>
                          </div>
                        ))}
                        {/* EXTEND tab generated clips */}
                        {extendClips.map((cl,i) => (
                          <div key={i} style={{background:C.bg3,border:`1px solid rgba(77,166,255,0.4)`,borderRadius:"3px",padding:"10px",display:"flex",gap:"10px",alignItems:"center"}}>
                            <div style={{fontSize:"1.1rem"}}>⚡</div>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontFamily:mono,fontSize:"0.56rem",color:"#4da6ff",fontWeight:"700"}}>Extended Clip {i+1}</div>
                              <div style={{fontFamily:mono,fontSize:"0.44rem",color:C.text3,marginTop:"2px"}}>{cl.duration}s · Manual</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    : <div style={{fontFamily:mono,fontSize:"0.52rem",color:C.text3}}>No clips yet — generate a video first</div>
                  }
                </>
              );
            })()}
            {activeTab==="FX" && (
              <>
                <div style={{fontFamily:mono,fontSize:"0.5rem",letterSpacing:"2px",color:C.text2,marginBottom:"10px"}}>VISUAL EFFECTS</div>
                {Object.entries(FX_FILTERS).map(([fx,filter])=>(
                  <div key={fx} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 10px",background:activeFilter===filter?"rgba(212,168,67,0.08)":C.bg3,border:`1px solid ${activeFilter===filter?C.gold:C.border}`,borderRadius:"3px",marginBottom:"4px"}}>
                    <span style={{fontFamily:mono,fontSize:"0.52rem",color:activeFilter===filter?C.gold:C.text2}}>{fx}{activeFilter===filter?" ✓":""}</span>
                    <button onClick={()=>{ setActiveFilter(prev=>prev===filter?"":filter); if(videoRef.current) videoRef.current.style.filter=activeFilter===filter?"":filter; }}
                      style={{fontFamily:mono,fontSize:"0.46rem",color:activeFilter===filter?C.bg:C.gold,border:`1px solid ${C.gold}`,background:activeFilter===filter?C.gold:"transparent",padding:"2px 8px",cursor:"pointer",borderRadius:"2px"}}>{activeFilter===filter?"REMOVE":"ADD"}</button>
                  </div>
                ))}
              </>
            )}
            {activeTab==="EXTEND" && (() => {
              const handleExtend = async () => {
                if (!extendPrompt.trim()||extending||!apiKey||!studioData?.imageDataUrl) return;
                setExtending(true);
                try {
                  const imgB64  = studioData.imageDataUrl.split(",")[1];
                  const imgMime = "image/png";
                  const op   = await startVeo(apiKey, extendPrompt.trim(), imgB64, imgMime, 5);
                  const uri  = await pollVeo(apiKey, op, ()=>{});
                  const clip = { videoUrl:uri, duration:5, prompt:extendPrompt.trim() };
                  setExtendClips(p=>[...p, clip]);
                  setExtendPrompt("");
                } catch(e) { alert(`Extend failed: ${e.message}`); }
                finally { setExtending(false); }
              };
              return (
                <>
                  <div style={{fontFamily:mono,fontSize:"0.5rem",letterSpacing:"2px",color:C.text2,marginBottom:"10px"}}>EXTEND VIDEO</div>
                  <div style={{fontFamily:mono,fontSize:"0.5rem",color:C.text3,lineHeight:1.7,marginBottom:"10px"}}>Generate additional B-roll clips manually and add to timeline.</div>
                  <textarea value={extendPrompt} onChange={e=>setExtendPrompt(e.target.value)}
                    placeholder="Describe the next scene to generate...\ne.g. Neon-lit alley, rain falling, cinematic 4K HDR"
                    style={{width:"100%",boxSizing:"border-box",background:C.bg3,border:`1px solid ${extendPrompt?C.gold:C.border2}`,borderRadius:"3px",padding:"8px",fontFamily:mono,fontSize:"0.55rem",color:C.text2,resize:"vertical",minHeight:"70px",outline:"none"}}/>
                  <button onClick={handleExtend} disabled={extending||!extendPrompt.trim()||!apiKey}
                    style={{marginTop:"8px",width:"100%",padding:"10px",background:extending?"rgba(212,168,67,0.15)":extendPrompt.trim()?C.gold:C.bg3,border:`1px solid ${extendPrompt.trim()?C.gold:C.border}`,color:extendPrompt.trim()?C.bg:C.text3,fontFamily:mono,fontSize:"0.6rem",fontWeight:"700",letterSpacing:"2px",cursor:extendPrompt.trim()&&!extending?"pointer":"not-allowed",borderRadius:"3px"}}>
                    {extending?"⚡ GENERATING CLIP..":"⚡ GENERATE NEXT CLIP"}
                  </button>
                  {extendClips.length>0&&<div style={{fontFamily:mono,fontSize:"0.46rem",color:C.green,marginTop:"8px"}}>✓ {extendClips.length} extended clip{extendClips.length>1?"s":""} added — see CLIPS tab</div>}
                </>
              );
            })()}
            {activeTab==="AUDIO" && (
              <>
                <div style={{fontFamily:mono,fontSize:"0.5rem",letterSpacing:"2px",color:C.text2,marginBottom:"10px"}}>AUDIO TRACKS</div>
                {studioData?.audioFile
                  ? <div style={{background:C.bg3,border:`1px solid ${C.green}`,borderRadius:"3px",padding:"10px"}}>
                      <div style={{fontFamily:mono,fontSize:"0.58rem",color:C.green,fontWeight:"700"}}>✓ Original Track</div>
                      <div style={{fontFamily:mono,fontSize:"0.48rem",color:C.text3,marginTop:"2px"}}>{studioData.audioFile.name}</div>
                    </div>
                  : <div style={{fontFamily:mono,fontSize:"0.52rem",color:C.text3}}>Generate a video to see audio tracks</div>
                }
              </>
            )}
          </div>
        </div>
      </div>

      {/* TIMELINE */}
      <div style={{borderTop:`1px solid ${C.border}`,background:C.bg2,flexShrink:0}}>
        {/* Header */}
        <div style={{display:"flex",alignItems:"center",padding:"5px 12px",borderBottom:`1px solid ${C.border}`,gap:"8px"}}>
          <div style={{fontFamily:mono,fontSize:"0.58rem",fontWeight:"700",letterSpacing:"2px",color:C.gold}}>TIMELINE</div>
          {/* 5.4/5.6 CUT/TRIM/SPLIT wired buttons */}
          {["CUT","TRIM","SPLIT"].map(t=>(
            <button key={t} onClick={t!=="TRIM"?handleCut:undefined}
              title={t==="TRIM"?"Trim — drag clip handles (Phase 5.5 — coming)":undefined}
              style={{fontFamily:mono,fontSize:"0.48rem",
                color:hasVideo?C.text2:C.text3,
                border:`1px solid ${hasVideo?C.border2:C.border}`,
                background:C.bg3,padding:"3px 10px",
                cursor:hasVideo&&t!=="TRIM"?"pointer":"not-allowed",
                borderRadius:"2px",letterSpacing:"1px",
                opacity:t==="TRIM"?0.5:1}}>{t}</button>
          ))}
          <div style={{flex:1}}/>
          <span style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3}}>{fmtTime(currentTime)} / {fmtTime(duration)} · {zoom}%</span>
          {/* 4.9 — wired MP4 export button */}
          <button onClick={handleExport} disabled={exporting||!hasVideo}
            style={{fontFamily:mono,fontSize:"0.46rem",
              color:exporting?C.gold:hasVideo?C.text2:C.text3,
              border:`1px solid ${exporting?C.gold:hasVideo?C.border2:C.border}`,
              background:exporting?"rgba(212,168,67,0.1)":C.bg3,
              padding:"3px 10px",cursor:hasVideo&&!exporting?"pointer":"not-allowed",borderRadius:"2px"}}>
            {exporting?`⚡ ${exportPct}%`:exportPct===100?"✓ DONE":"↓ EXPORT"}
          </button>
          <button title="MOV export coming soon" disabled
            style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,border:`1px solid ${C.border}`,background:C.bg3,padding:"3px 8px",cursor:"not-allowed",borderRadius:"2px",opacity:0.4}}>↓ MOV</button>
          <button
            onClick={()=>setAspectRatio(r=>r==="9:16"?"16:9":"9:16")}
            style={{fontFamily:mono,fontSize:"0.46rem",color:C.gold,border:`1px solid ${C.gold}`,background:"transparent",padding:"3px 8px",cursor:"pointer",borderRadius:"2px"}}>
            {aspectRatio}
          </button>
        </div>
        {/* 4.10 — export progress bar */}
        {exporting && (
          <div style={{height:"3px",background:C.border,position:"relative"}}>
            <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${exportPct}%`,background:C.gold,transition:"width 0.4s",borderRadius:"0 2px 2px 0"}}/>
          </div>
        )}

        {/* Tracks */}
        <div style={{display:"flex"}}>
          {/* Labels */}
          <div style={{width:"110px",flexShrink:0,borderRight:`1px solid ${C.border}`}}>
            <div style={{height:"20px",background:C.bg3,borderBottom:`1px solid ${C.border}`}}/>
            {TRACKS.map(tr=>(
              <div key={tr.id} style={{height:"36px",borderBottom:`1px solid ${C.border}`,display:"flex",alignItems:"center",padding:"0 8px",gap:"5px"}}>
                <span style={{fontSize:"0.75rem"}}>{tr.icon}</span>
                <span style={{fontFamily:mono,fontSize:"0.46rem",color:C.text3,letterSpacing:"0.5px"}}>{tr.label}</span>
                {/* 5.7 — track mute toggle */}
                <span onClick={()=>toggleTrackMute(tr.id)}
                  title={mutedTracks.has(tr.id)?"Unmute track":"Mute track"}
                  style={{marginLeft:"auto",fontSize:"0.65rem",cursor:"pointer",
                    opacity: mutedTracks.has(tr.id)?1:0.35,
                    color:   mutedTracks.has(tr.id)?C.red:"inherit",
                    filter:  mutedTracks.has(tr.id)?`drop-shadow(0 0 3px ${C.red})`:"none",
                  }}>🔇</span>
              </div>
            ))}
          </div>

          {/* Track content + ruler */}
          <div ref={timelineRef} style={{flex:1,overflowX:"auto",position:"relative"}}>
            {/* 5.1 Ruler — click to seek */}
            <div onClick={handleRulerClick}
              style={{height:"20px",background:C.bg3,borderBottom:`1px solid ${C.border}`,position:"relative",minWidth:`${totalW}px`,cursor:"pointer"}}>
              {Array.from({length:Math.ceil(duration)+1},(_,i)=>(
                <div key={i} style={{position:"absolute",left:`${i*pxPerSec}px`,top:0,height:"100%",borderLeft:`1px solid ${C.border2}`,display:"flex",alignItems:"flex-end",paddingBottom:"2px"}}>
                  <span style={{fontFamily:mono,fontSize:"0.36rem",color:C.text3,paddingLeft:"2px"}}>{fmtTime(i)}</span>
                </div>
              ))}
              {/* 5.2 Playhead — drag to scrub */}
              <div onPointerDown={handlePlayheadMouseDown}
                style={{position:"absolute",left:`${currentTime*pxPerSec}px`,top:0,height:`${20+4*36}px`,width:"2px",background:C.gold,zIndex:10,cursor:"ew-resize"}}
              >
                {/* drag handle knob */}
                <div style={{position:"absolute",top:0,left:"-5px",width:"12px",height:"12px",background:C.gold,borderRadius:"50%",zIndex:11}}/>
              </div>
            </div>

            {/* Track rows */}
            {TRACKS.map((tr,ti)=>(
              <div key={tr.id} style={{height:"36px",borderBottom:`1px solid ${C.border}`,position:"relative",minWidth:`${totalW}px`,background:ti%2===0?C.bg3:C.bg2}}>
                {tr.id==="video" && hasVideo && (() => {
                  const clipDur  = studioData?.duration || 8;
                  const cuts     = studioData?.cutPoints || [];
                  const vidStart = clipOffsets["video"] ?? 0;
                  const trim     = trimPoints["video"]  || { in: 0, out: clipDur };
                  const trimmedW = Math.max(0, (trim.out - trim.in) * pxPerSec);
                  const clipLeft = vidStart * pxPerSec + trim.in * pxPerSec;
                  return (<>
                    {/* Main performance clip block — draggable + trimmable */}
                    <div
                      onPointerDown={makeClipDragHandler("video", 0)}
                      style={{position:"absolute",left:`${clipLeft}px`,top:"4px",height:"28px",width:`${trimmedW}px`,background:"rgba(212,168,67,0.2)",border:`1px solid ${C.gold}`,borderRadius:"2px",display:"flex",alignItems:"center",padding:"0 8px",overflow:"hidden",cursor:"grab",userSelect:"none"}}>
                      <span style={{fontFamily:mono,fontSize:"0.42rem",color:C.gold,whiteSpace:"nowrap"}}>🎬 Main Performance · {clipDur}s</span>
                      {/* Trim handle — left */}
                      <div onPointerDown={makeTrimHandler("video","in",clipDur)}
                        style={{position:"absolute",left:0,top:0,width:"6px",height:"100%",cursor:"w-resize",background:"rgba(212,168,67,0.5)",borderRadius:"2px 0 0 2px"}}/>
                      {/* Trim handle — right */}
                      <div onPointerDown={makeTrimHandler("video","out",clipDur)}
                        style={{position:"absolute",right:0,top:0,width:"6px",height:"100%",cursor:"e-resize",background:"rgba(212,168,67,0.5)",borderRadius:"0 2px 2px 0"}}/>
                    </div>
                    {/* Cut point markers — red vertical lines at each Gemini sync break */}
                    {cuts.map((cp,i) => (
                      <div key={i} title={`${cp.t.toFixed(1)}s — ${cp.reason}`}
                        style={{position:"absolute",left:`${cp.t*pxPerSec}px`,top:"2px",height:"32px",width:"2px",background:C.red,zIndex:5,cursor:"pointer",opacity:0.85}}
                      >
                        <div style={{position:"absolute",top:"-14px",left:"-4px",fontFamily:mono,fontSize:"0.34rem",color:C.red,whiteSpace:"nowrap",letterSpacing:"0.5px"}}>✂ {cp.t.toFixed(1)}s</div>
                      </div>
                    ))}
                    {/* Manual cut markers — gold vertical lines added by user */}
                    {manualCuts.map((t,i) => (
                      <div key={`mc-${i}`} title={`Manual cut at ${t.toFixed(2)}s — click to remove`}
                        onClick={()=>setManualCuts(prev=>prev.filter(c=>c!==t))}
                        style={{position:"absolute",left:`${t*pxPerSec}px`,top:"2px",height:"32px",width:"2px",background:C.gold,zIndex:6,cursor:"pointer",opacity:0.9}}
                      >
                        <div style={{position:"absolute",top:"-14px",left:"-4px",fontFamily:mono,fontSize:"0.34rem",color:C.gold,whiteSpace:"nowrap",letterSpacing:"0.5px"}}>✂ {t.toFixed(1)}s</div>
                      </div>
                    ))}
                  </>);
                })()}
                {tr.id==="audio" && hasVideo && studioData?.audioFile && (
                  <div style={{position:"absolute",left:"2px",top:"4px",height:"28px",width:`${totalW-4}px`,background:"rgba(0,230,118,0.1)",border:`1px solid ${C.green}`,borderRadius:"2px",display:"flex",alignItems:"center",padding:"0 8px",overflow:"hidden"}}>
                    <span style={{fontFamily:mono,fontSize:"0.42rem",color:C.green,whiteSpace:"nowrap"}}>🎵 {studioData.audioFile.name.slice(0,32)}</span>
                  </div>
                )}
                {/* 3.6 / 5.3 / 5.5 B-ROLL track — draggable + trimmable */}
                {tr.id==="broll" && hasVideo && (studioData?.brollClips||[]).map((cl,i) => {
                  const bId    = `broll_${i}`;
                  const bStart = clipOffsets[bId] ?? cl.timestamp;
                  const bTrim  = trimPoints[bId]  || { in: 0, out: cl.duration };
                  const bW     = Math.max(0, (bTrim.out - bTrim.in) * pxPerSec);
                  const bLeft  = bStart * pxPerSec + bTrim.in * pxPerSec;
                  return (
                    <div key={i} title={`B-Roll ${i+1} at ${bStart.toFixed(1)}s — ${cl.reason}`}
                      onPointerDown={makeClipDragHandler(bId, cl.timestamp)}
                      style={{position:"absolute",left:`${bLeft}px`,top:"4px",height:"28px",width:`${bW}px`,background:"rgba(212,168,67,0.3)",border:`1px solid ${C.gold}`,borderRadius:"2px",display:"flex",alignItems:"center",padding:"0 5px",overflow:"hidden",cursor:"grab",userSelect:"none"}}>
                      <span style={{fontFamily:mono,fontSize:"0.38rem",color:C.gold,whiteSpace:"nowrap"}}>🎥 B{i+1} · {cl.duration}s</span>
                      <div onPointerDown={makeTrimHandler(bId,"in",cl.duration)}
                        style={{position:"absolute",left:0,top:0,width:"6px",height:"100%",cursor:"w-resize",background:"rgba(212,168,67,0.5)",borderRadius:"2px 0 0 2px"}}/>
                      <div onPointerDown={makeTrimHandler(bId,"out",cl.duration)}
                        style={{position:"absolute",right:0,top:0,width:"6px",height:"100%",cursor:"e-resize",background:"rgba(212,168,67,0.5)",borderRadius:"0 2px 2px 0"}}/>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── PHASE 6: LANDING, AUTH, PROFILE ───────────────────────────

const TESTIMONIALS = [
  { handle:"@lilwave_atl",   platform:"X",  text:"Generated my whole EP rollout in one afternoon. Veo sync is uncanny — people thought it was a real director.", badge:"X" },
  { handle:"@novafxbeats",   platform:"IG", text:"Used it for three singles back to back. The B-roll cutaways are cinematic — fans keep asking what studio I used.", badge:"IG" },
  { handle:"@treysonmusic",  platform:"TT", text:"Went viral with my first Veo-generated clip. 2.3M views. Chad Studio is the cheat code nobody's talking about.", badge:"TT" },
  { handle:"@solstice_kira", platform:"IG", text:"The Voice DNA feature matched my flow perfectly. Prompt came out exactly how I described it on the first try.", badge:"IG" },
  { handle:"@djpulsewave",   platform:"X",  text:"Nano Banana 2 nailed my likeness from just one selfie. Insane tech. Running it every drop now.", badge:"X" },
  { handle:"@marq_official", platform:"TT", text:"From zero to final export in under 10 minutes. The timeline editor actually works. No cap.", badge:"TT" },
];

const PIPELINE_STEPS_LP = [
  { icon:"📁", t:"Asset Ingest",     d:"Drop your face photo and audio. Loaded into memory instantly." },
  { icon:"🎙", t:"Transcription",    d:"Gemini 2.5 Flash reads your lyrics, tempo, and phrasing." },
  { icon:"🧠", t:"Prompt Build",     d:"AI engineers a precision Veo prompt from all your inputs." },
  { icon:"🎬", t:"Video Generate",   d:"Veo 3.1 Fast renders a 4–8s cinematic performance clip." },
  { icon:"🔄", t:"Sync Analysis",    d:"Gemini watches the video frame-by-frame, flags lip-sync breaks." },
  { icon:"🎥", t:"B-Roll Generate",  d:"Veo creates cutaway clips timed to every sync break." },
  { icon:"🎞", t:"Compose + Grade",  d:"Clips merged, colour-graded, and audio replaced." },
];

function LandingPage({ onGetStarted }) {
  const [scrolled,    setScrolled]    = useState(false);
  const [menuOpen,    setMenuOpen]    = useState(false);
  // Hero IDs seeded immediately so above-the-fold content is never invisible
  const [visible,     setVisible]     = useState(new Set(["hero-badge","hero-h1","hero-p","hero-ctas","hero-mockup"]));

  // SEO meta tags
  useEffect(() => {
    document.title = "Chad Studio — AI Music Video Generator";
    const metas = [
      { name:"description", content:"Create cinematic AI music videos with your face and voice. Powered by Nano Banana 2, Gemini 2.5 Flash, and Veo 3.1 Fast." },
      { name:"keywords",    content:"AI music video, Veo 3, lip sync, Gemini, Nano Banana 2, music video generator" },
      { property:"og:title",       content:"Chad Studio — AI Music Video Generator" },
      { property:"og:description", content:"Your face. Your voice. Your video. The world's most advanced AI music video pipeline." },
      { property:"og:type",        content:"website" },
      { name:"twitter:card",  content:"summary_large_image" },
      { name:"twitter:title", content:"Chad Studio — AI Music Video Generator" },
    ];
    const tags = metas.map(attrs => {
      const m = document.createElement("meta");
      Object.entries(attrs).forEach(([k,v]) => m.setAttribute(k,v));
      document.head.appendChild(m);
      return m;
    });
    return () => { tags.forEach(m => m.remove()); document.title = "Chad Studio"; };
  }, []);

  // Nav scroll state
  useEffect(() => {
    const el = document.getElementById("lp-scroll");
    if (!el) return;
    const onScroll = () => setScrolled(el.scrollTop > 40);
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll-reveal via IntersectionObserver
  useEffect(() => {
    const targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;
    const obs = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) setVisible(prev => new Set([...prev, e.target.dataset.reveal])); });
    }, { threshold: 0, rootMargin: "0px 0px -40px 0px" });
    targets.forEach(t => obs.observe(t));
    return () => obs.disconnect();
  }, []);

  const rev = (id, delay=0) => ({
    "data-reveal": id,
    style: {
      opacity: visible.has(id) ? 1 : 0,
      transform: visible.has(id) ? "translateY(0)" : "translateY(28px)",
      transition: `opacity 0.55s ease ${delay}ms, transform 0.55s ease ${delay}ms`,
    }
  });

  const navLinks = ["#pipeline","#how","#proof","#pricing"];
  const navLabels = ["PIPELINE","HOW IT WORKS","ARTISTS","PRICING"];

  return (
    <div id="lp-scroll" style={{flex:1,overflowY:"auto",background:C.bg,color:C.text,position:"relative"}}>

      {/* ── STICKY LANDING NAV ── */}
      <nav style={{
        position:"sticky",top:0,zIndex:100,
        background: scrolled ? "rgba(8,8,8,0.97)" : "transparent",
        borderBottom: scrolled ? `1px solid ${C.border}` : "1px solid transparent",
        boxShadow: scrolled ? "0 2px 20px rgba(0,0,0,0.5)" : "none",
        transition:"all 0.25s",
        display:"flex",alignItems:"center",padding:"0 24px",height:"56px",
      }}>
        <div style={{fontFamily:mono,fontWeight:"700",fontSize:"1rem",letterSpacing:"2px",flex:1}}>
          <span style={{color:C.gold}}>CHAD</span><span style={{color:C.text}}>STUDIO</span><span style={{color:C.text3}}>.IO</span>
        </div>
        {/* Desktop nav links */}
        <div style={{display:"flex",gap:"32px",alignItems:"center"}} className="lp-desktop-nav">
          {navLabels.map((label,i) => (
            <a key={label} href={navLinks[i]}
              style={{fontFamily:mono,fontSize:"0.55rem",letterSpacing:"2px",color:C.text3,textDecoration:"none",transition:"color 0.15s"}}
              onMouseOver={e=>e.target.style.color=C.gold} onMouseOut={e=>e.target.style.color=C.text3}>
              {label}
            </a>
          ))}
          <button onClick={onGetStarted}
            style={{marginLeft:"8px",padding:"8px 20px",fontFamily:mono,fontWeight:"700",fontSize:"0.56rem",letterSpacing:"2px",background:C.gold,color:C.bg,border:"none",borderRadius:"3px",cursor:"pointer"}}>
            OPEN STUDIO
          </button>
        </div>
        {/* Mobile hamburger */}
        <button onClick={()=>setMenuOpen(o=>!o)}
          style={{display:"none",flexDirection:"column",justifyContent:"center",gap:"5px",background:"transparent",border:"none",cursor:"pointer",padding:"4px",width:"32px",height:"32px"}}
          className="lp-hamburger" aria-label="Menu">
          {[0,1,2].map(i=>(
            <span key={i} style={{
              display:"block",height:"2px",background:C.gold,borderRadius:"2px",
              transform: menuOpen ? (i===0?"rotate(45deg) translate(5px,5px)":i===2?"rotate(-45deg) translate(5px,-5px)":"scaleX(0)") : "none",
              transition:"transform 0.2s",
            }}/>
          ))}
        </button>
      </nav>

      {/* Mobile menu drawer */}
      {menuOpen && (
        <div style={{position:"sticky",top:"56px",zIndex:99,background:"rgba(8,8,8,0.98)",borderBottom:`1px solid ${C.border}`,padding:"16px 24px",display:"flex",flexDirection:"column",gap:"16px"}}>
          {navLabels.map((label,i) => (
            <a key={label} href={navLinks[i]} onClick={()=>setMenuOpen(false)}
              style={{fontFamily:mono,fontSize:"0.7rem",letterSpacing:"2px",color:C.text2,textDecoration:"none",padding:"8px 0",borderBottom:`1px solid ${C.border}`}}>
              {label}
            </a>
          ))}
          <button onClick={()=>{setMenuOpen(false);onGetStarted();}}
            style={{padding:"12px",fontFamily:mono,fontWeight:"700",fontSize:"0.7rem",letterSpacing:"2px",background:C.gold,color:C.bg,border:"none",borderRadius:"3px",cursor:"pointer"}}>
            OPEN STUDIO
          </button>
        </div>
      )}

      {/* ── HERO ── */}
      <div style={{padding:"90px 24px 80px",textAlign:"center",borderBottom:`1px solid ${C.border}`,background:`radial-gradient(ellipse at 50% 0%, rgba(212,168,67,0.06) 0%, transparent 70%)`}}>
        <div {...rev("hero-badge",0)} style={{...rev("hero-badge",0).style,display:"inline-block",fontFamily:mono,fontSize:"0.55rem",letterSpacing:"3px",color:C.gold,background:"rgba(212,168,67,0.1)",border:`1px solid rgba(212,168,67,0.3)`,borderRadius:"20px",padding:"5px 16px",marginBottom:"24px"}}>
          POWERED BY VEO 3.1 FAST · GEMINI 2.5 FLASH · NANO BANANA 2
        </div>
        <h1 {...rev("hero-h1",80)} style={{...rev("hero-h1",80).style,fontSize:"clamp(2.2rem,6vw,4rem)",fontFamily:mono,margin:"0 0 24px 0",letterSpacing:"-1px",lineHeight:1.15}}>
          Your Face.<br/><span style={{color:C.gold}}>Your Voice.</span> Your Video.
        </h1>
        <p {...rev("hero-p",160)} style={{...rev("hero-p",160).style,fontSize:"1.05rem",color:C.text2,maxWidth:"560px",margin:"0 auto 36px auto",lineHeight:1.7}}>
          The world's most advanced AI music video generator. Upload a photo and your track — Chad Studio builds the whole cinematic pipeline in minutes.
        </p>
        <div {...rev("hero-ctas",240)} style={{...rev("hero-ctas",240).style,display:"flex",gap:"12px",justifyContent:"center",flexWrap:"wrap"}}>
          <button onClick={onGetStarted}
            style={{padding:"14px 36px",fontSize:"0.9rem",fontFamily:mono,fontWeight:"700",background:C.gold,color:C.bg,border:"none",borderRadius:"4px",cursor:"pointer",letterSpacing:"2px"}}>
            START FOR FREE →
          </button>
          <a href="#how" style={{padding:"14px 28px",fontSize:"0.9rem",fontFamily:mono,fontWeight:"700",background:"transparent",color:C.text2,border:`1px solid ${C.border2}`,borderRadius:"4px",cursor:"pointer",letterSpacing:"1px",textDecoration:"none",display:"inline-block"}}>
            SEE HOW IT WORKS
          </a>
        </div>

        {/* Hero product mockup — CSS phone frame */}
        <div {...rev("hero-mockup",320)} style={{...rev("hero-mockup",320).style,margin:"56px auto 0",width:"220px",background:C.bg2,border:`1px solid ${C.border2}`,borderRadius:"24px",padding:"12px",boxShadow:"0 24px 60px rgba(0,0,0,0.6)"}}>
          <div style={{background:C.bg3,borderRadius:"16px",padding:"14px",textAlign:"left"}}>
            <div style={{fontFamily:mono,fontSize:"0.45rem",color:C.gold,letterSpacing:"2px",marginBottom:"10px"}}>CHAD STUDIO · GENERATING</div>
            {PIPELINE_STAGES.map((s,i) => {
              const done = i < 4; const active = i === 4;
              return (
                <div key={s.id} style={{display:"flex",alignItems:"center",gap:"7px",marginBottom:"6px"}}>
                  <div style={{width:"7px",height:"7px",borderRadius:"50%",flexShrink:0,background:done?C.green:active?C.gold:C.border2,boxShadow:active?`0 0 6px ${C.gold}`:"none"}}/>
                  <span style={{fontFamily:mono,fontSize:"0.38rem",color:done?C.green:active?C.gold:C.text3,letterSpacing:"0.5px"}}>{s.name}</span>
                  {active && <span style={{fontFamily:mono,fontSize:"0.36rem",color:C.gold,marginLeft:"auto",opacity:0.7}}>●●●</span>}
                </div>
              );
            })}
            <div style={{marginTop:"10px",height:"3px",background:C.border,borderRadius:"2px",overflow:"hidden"}}>
              <div style={{width:"58%",height:"100%",background:C.gold,borderRadius:"2px",animation:"pulse-bar 2s ease-in-out infinite"}}/>
            </div>
            <div style={{fontFamily:mono,fontSize:"0.38rem",color:C.text3,marginTop:"5px"}}>58% · 1m 43s elapsed</div>
          </div>
        </div>
      </div>

      {/* ── PIPELINE ── */}
      <div id="pipeline" style={{padding:"80px 24px",background:C.bg2,borderBottom:`1px solid ${C.border}`}}>
        <div {...rev("pipe-head",0)} style={{...rev("pipe-head",0).style,textAlign:"center",marginBottom:"48px"}}>
          <h2 style={{fontSize:"1.5rem",fontFamily:mono,letterSpacing:"3px",color:C.gold,margin:"0 0 10px 0"}}>THE 7-STAGE PIPELINE</h2>
          <p style={{fontFamily:mono,fontSize:"0.65rem",color:C.text3,letterSpacing:"1px"}}>Every generation runs through all seven stages automatically.</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(220px,1fr))",gap:"16px",maxWidth:"1100px",margin:"0 auto"}}>
          {PIPELINE_STEPS_LP.map((s,i) => (
            <div key={s.t} {...rev(`pipe-${i}`, i*60)} style={{...rev(`pipe-${i}`,i*60).style,padding:"22px",background:C.bg3,border:`1px solid ${C.border}`,borderRadius:"6px",borderTop:`2px solid ${C.gold}`}}>
              <div style={{fontSize:"1.6rem",marginBottom:"12px"}}>{s.icon}</div>
              <div style={{fontFamily:mono,fontWeight:"700",fontSize:"0.75rem",marginBottom:"6px",letterSpacing:"1px",color:C.text}}>{s.t}</div>
              <div style={{fontFamily:mono,fontSize:"0.58rem",color:C.text3,lineHeight:1.6}}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── HOW IT WORKS ── */}
      <div id="how" style={{padding:"80px 24px",borderBottom:`1px solid ${C.border}`}}>
        <div {...rev("how-head",0)} style={{...rev("how-head",0).style,textAlign:"center",marginBottom:"48px"}}>
          <h2 style={{fontSize:"1.5rem",fontFamily:mono,letterSpacing:"3px",color:C.gold,margin:0}}>HOW IT WORKS</h2>
        </div>
        <div style={{display:"flex",gap:"24px",maxWidth:"960px",margin:"0 auto",flexWrap:"wrap"}}>
          {[
            {n:"01", t:"Upload Your Assets",    d:"Drop a face photo and your audio track. Optionally record a 30-second voice sample for the Voice DNA feature."},
            {n:"02", t:"Configure the Scene",   d:"Pick performance style, camera angle, visual style, scene tags, and duration. Paste lyrics or let Gemini transcribe."},
            {n:"03", t:"Hit Generate",           d:"The 7-stage pipeline runs automatically. Watch every stage complete in real time on the progress panel."},
            {n:"04", t:"Edit in Advanced Studio",d:"Review your video, apply FX presets, add manual cut markers, and export a finished WebM with your original audio baked in."},
          ].map((step,i) => (
            <div key={step.n} {...rev(`how-${i}`,i*80)} style={{...rev(`how-${i}`,i*80).style,flex:"1 1 200px",padding:"28px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px"}}>
              <div style={{fontFamily:mono,fontSize:"2rem",fontWeight:"700",color:"rgba(212,168,67,0.2)",marginBottom:"16px",lineHeight:1}}>{step.n}</div>
              <h3 style={{fontFamily:mono,fontSize:"0.8rem",letterSpacing:"1px",marginBottom:"10px",color:C.text}}>{step.t}</h3>
              <p style={{fontFamily:mono,fontSize:"0.6rem",color:C.text3,lineHeight:1.7,margin:0}}>{step.d}</p>
            </div>
          ))}
        </div>
      </div>

      {/* ── SOCIAL PROOF ── */}
      <div id="proof" style={{padding:"80px 24px",background:C.bg2,borderBottom:`1px solid ${C.border}`}}>
        <div {...rev("proof-head",0)} style={{...rev("proof-head",0).style,textAlign:"center",marginBottom:"48px"}}>
          <h2 style={{fontSize:"1.5rem",fontFamily:mono,letterSpacing:"3px",color:C.gold,margin:"0 0 10px 0"}}>ARTISTS ARE RUNNING IT</h2>
          <p style={{fontFamily:mono,fontSize:"0.65rem",color:C.text3,letterSpacing:"1px"}}>Real feedback from the community.</p>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(260px,1fr))",gap:"16px",maxWidth:"1100px",margin:"0 auto"}}>
          {TESTIMONIALS.map((t,i) => (
            <div key={t.handle} {...rev(`proof-${i}`,i*55)} style={{...rev(`proof-${i}`,i*55).style,padding:"22px",background:C.bg3,border:`1px solid ${C.border}`,borderRadius:"6px",borderTop:`2px solid ${C.gold}`}}>
              <p style={{fontFamily:mono,fontSize:"0.65rem",color:C.text2,lineHeight:1.8,fontStyle:"italic",margin:"0 0 16px 0"}}>"{t.text}"</p>
              <div style={{display:"flex",alignItems:"center",gap:"8px"}}>
                <div style={{width:"28px",height:"28px",borderRadius:"50%",background:C.bg4,border:`1px solid ${C.border2}`,display:"flex",alignItems:"center",justifyContent:"center",fontFamily:mono,fontSize:"0.5rem",color:C.gold,fontWeight:"700"}}>
                  {t.handle[1].toUpperCase()}
                </div>
                <div>
                  <div style={{fontFamily:mono,fontSize:"0.58rem",color:C.text,fontWeight:"700"}}>{t.handle}</div>
                </div>
                <div style={{marginLeft:"auto",fontFamily:mono,fontSize:"0.44rem",color:C.bg,background:t.badge==="X"?C.text:t.badge==="IG"?"#c13584":"#ff0050",padding:"2px 7px",borderRadius:"3px",fontWeight:"700"}}>
                  {t.badge}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* ── CTA STRIP ── */}
      <div {...rev("cta-strip",0)} style={{...rev("cta-strip",0).style,padding:"72px 24px",textAlign:"center",background:`linear-gradient(135deg, rgba(212,168,67,0.06) 0%, transparent 60%)`,borderBottom:`1px solid ${C.border}`}}>
        <h2 style={{fontSize:"clamp(1.6rem,4vw,2.8rem)",fontFamily:mono,margin:"0 0 16px 0",letterSpacing:"-0.5px"}}>
          Ready to go <span style={{color:C.gold}}>cinematic?</span>
        </h2>
        <p style={{fontFamily:mono,fontSize:"0.75rem",color:C.text3,margin:"0 auto 36px auto",maxWidth:"480px",lineHeight:1.7}}>
          No software to install. No video editing skills required. Just your face, your track, and your vision.
        </p>
        <button onClick={onGetStarted}
          style={{padding:"16px 44px",fontSize:"1rem",fontFamily:mono,fontWeight:"700",background:C.gold,color:C.bg,border:"none",borderRadius:"4px",cursor:"pointer",letterSpacing:"2px",boxShadow:"0 0 30px rgba(212,168,67,0.25)"}}>
          CREATE YOUR VIDEO FREE →
        </button>
      </div>

      {/* ── PRICING ── */}
      <div id="pricing" style={{padding:"80px 24px",background:C.bg2,borderBottom:`1px solid ${C.border}`}}>
        <div {...rev("price-head",0)} style={{...rev("price-head",0).style,textAlign:"center",marginBottom:"48px"}}>
          <h2 style={{fontSize:"1.5rem",fontFamily:mono,letterSpacing:"3px",color:C.gold,margin:"0 0 10px 0"}}>PRICING</h2>
          <p style={{fontFamily:mono,fontSize:"0.65rem",color:C.text3,letterSpacing:"1px"}}>Start free. Scale when you're ready.</p>
        </div>
        <div style={{display:"flex",gap:"20px",maxWidth:"960px",margin:"0 auto",flexWrap:"wrap",justifyContent:"center"}}>
          {[
            {t:"FREE",     p:"$0",  freq:"forever", f:["Watermarked 720p","10s max duration","Standard 16:9 aspect","Community support"]},
            {t:"PRO",      p:"$19", freq:"/mo",      f:["4K HDR export","60s duration","9:16 mobile aspect","Priority queue","No watermark"], hi:true},
            {t:"DIRECTOR", p:"$49", freq:"/mo",      f:["Uncapped generations","Advanced FX API","Custom model tuning","Commercial rights","White-label export"]},
          ].map((tier,i) => (
            <div key={tier.t} {...rev(`price-${i}`,i*80)} style={{...rev(`price-${i}`,i*80).style,flex:"1 1 260px",maxWidth:"320px",padding:"36px 28px",background:C.bg3,border:`1px solid ${tier.hi?C.gold:C.border}`,borderRadius:"6px",position:"relative"}}>
              {tier.hi && <div style={{position:"absolute",top:"-13px",left:"50%",transform:"translateX(-50%)",background:C.gold,color:C.bg,padding:"4px 14px",borderRadius:"20px",fontFamily:mono,fontSize:"0.55rem",fontWeight:"700",letterSpacing:"1px",whiteSpace:"nowrap"}}>MOST POPULAR</div>}
              <div style={{fontFamily:mono,fontSize:"0.7rem",color:C.text3,letterSpacing:"3px",marginBottom:"12px"}}>{tier.t}</div>
              <div style={{marginBottom:"28px"}}>
                <span style={{fontSize:"2.8rem",fontFamily:mono,fontWeight:"700",color:tier.hi?C.gold:C.text}}>{tier.p}</span>
                <span style={{fontFamily:mono,fontSize:"0.7rem",color:C.text3}}>{tier.freq}</span>
              </div>
              <div style={{display:"flex",flexDirection:"column",gap:"12px",marginBottom:"32px"}}>
                {tier.f.map((feat,fi) => (
                  <div key={fi} style={{display:"flex",alignItems:"flex-start",gap:"10px",fontFamily:mono,fontSize:"0.62rem",color:C.text2,lineHeight:1.5}}>
                    <span style={{color:C.green,flexShrink:0,marginTop:"1px"}}>✓</span>{feat}
                  </div>
                ))}
              </div>
              <button onClick={tier.p==="$0"?onGetStarted:undefined} disabled={tier.p!=="$0"}
                style={{width:"100%",padding:"12px",background:tier.hi?C.gold:tier.p==="$0"?C.bg4:"transparent",color:tier.hi?C.bg:tier.p==="$0"?C.text:C.text3,border:`1px solid ${tier.hi?C.gold:tier.p==="$0"?C.border2:C.border}`,borderRadius:"4px",fontFamily:mono,fontWeight:"700",cursor:tier.p==="$0"?"pointer":"not-allowed",fontSize:"0.62rem",letterSpacing:"1px"}}>
                {tier.p==="$0"?"GET STARTED FREE":tier.t==="PRO"?"COMING SOON":"CONTACT US"}
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* ── FOOTER ── */}
      <footer style={{padding:"48px 24px",background:C.bg,borderTop:`1px solid ${C.border}`}}>
        <div style={{maxWidth:"1100px",margin:"0 auto"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:"32px",marginBottom:"40px"}}>
            {/* Brand */}
            <div>
              <div style={{fontFamily:mono,fontWeight:"700",fontSize:"1.1rem",letterSpacing:"2px",marginBottom:"8px"}}>
                <span style={{color:C.gold}}>CHAD</span><span style={{color:C.text}}>STUDIO</span><span style={{color:C.text3}}>.IO</span>
              </div>
              <p style={{fontFamily:mono,fontSize:"0.58rem",color:C.text3,maxWidth:"260px",lineHeight:1.7,margin:0}}>
                AI-powered music video generation.<br/>Your face. Your voice. Your video.
              </p>
            </div>
            {/* Links */}
            <div style={{display:"flex",gap:"48px",flexWrap:"wrap"}}>
              {[
                { heading:"PRODUCT", links:[{l:"Generator",h:"#"},{l:"Advanced Studio",h:"#"},{l:"Pipeline",h:"#pipeline"},{l:"Pricing",h:"#pricing"}] },
                { heading:"COMPANY", links:[{l:"About",h:"#",soon:true},{l:"Blog",h:"#",soon:true},{l:"Careers",h:"#",soon:true},{l:"Contact",href:"mailto:hello@chadstudio.io"}] },
                { heading:"LEGAL",   links:[{l:"Privacy Policy",h:"#",soon:true},{l:"Terms of Service",h:"#",soon:true},{l:"Cookie Policy",h:"#",soon:true}] },
              ].map(col => (
                <div key={col.heading}>
                  <div style={{fontFamily:mono,fontSize:"0.52rem",letterSpacing:"2px",color:C.text3,marginBottom:"14px"}}>{col.heading}</div>
                  <div style={{display:"flex",flexDirection:"column",gap:"10px"}}>
                    {col.links.map(lk => (
                      <a key={lk.l} href={lk.href||lk.h}
                        onClick={lk.soon?(e=>{e.preventDefault();alert("Coming soon!");}) : undefined}
                        style={{fontFamily:mono,fontSize:"0.6rem",color:C.text2,textDecoration:"none",transition:"color 0.15s"}}
                        onMouseOver={e=>e.target.style.color=C.gold} onMouseOut={e=>e.target.style.color=C.text2}>
                        {lk.l}
                      </a>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          {/* Bottom bar */}
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:"24px",display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:"16px"}}>
            <div style={{fontFamily:mono,fontSize:"0.52rem",color:C.text3}}>© 2026 Chad Studio. All rights reserved.</div>
            <div style={{display:"flex",gap:"16px"}}>
              {[
                {label:"𝕏",  href:"https://twitter.com"},
                {label:"📸", href:"https://instagram.com"},
                {label:"▶",  href:"https://youtube.com"},
                {label:"♪",  href:"https://tiktok.com"},
              ].map(s => (
                <a key={s.label} href={s.href} target="_blank" rel="noreferrer"
                  style={{fontFamily:mono,fontSize:"0.8rem",color:C.text3,textDecoration:"none",transition:"color 0.2s"}}
                  onMouseOver={e=>e.target.style.color=C.gold} onMouseOut={e=>e.target.style.color=C.text3}>
                  {s.label}
                </a>
              ))}
            </div>
          </div>
        </div>
      </footer>

      {/* pulse-bar keyframe */}
      <style>{`
        @keyframes pulse-bar { 0%,100%{opacity:1} 50%{opacity:0.55} }
        @media(max-width:680px){
          .lp-desktop-nav{ display:none !important; }
          .lp-hamburger{ display:flex !important; }
        }
      `}</style>
    </div>
  );
}

function ResetPasswordPage({ onDone }) {
  const [password, setPassword] = useState("");
  const [confirm,  setConfirm]  = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [done,     setDone]     = useState(false);

  const handleReset = async (e) => {
    e.preventDefault();
    if (password !== confirm) { setError("Passwords do not match."); return; }
    setLoading(true); setError("");
    const { error: err } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (err) { setError(err.message); }
    else { setDone(true); setTimeout(onDone, 2000); }
  };

  return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:C.bg}}>
      <div style={{width:"100%",maxWidth:"400px",padding:"40px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"8px"}}>
        <h2 style={{fontFamily:mono,fontSize:"1.5rem",marginBottom:"10px",textAlign:"center"}}>SET NEW PASSWORD</h2>
        <p style={{fontFamily:mono,fontSize:"0.7rem",color:C.text2,textAlign:"center",marginBottom:"30px"}}>Choose a new password for your account.</p>
        {error && <div style={{padding:"10px",background:C.red+"22",color:C.red,border:`1px solid ${C.red}`,borderRadius:"4px",marginBottom:"20px",fontSize:"0.75rem"}}>{error}</div>}
        {done  && <div style={{padding:"10px",background:"#22553322",color:"#55cc88",border:"1px solid #55cc88",borderRadius:"4px",marginBottom:"20px",fontSize:"0.75rem"}}>Password updated! Redirecting to login...</div>}
        <form onSubmit={handleReset} style={{display:"flex",flexDirection:"column",gap:"16px"}}>
          <div>
            <div style={{fontFamily:mono,fontSize:"0.6rem",color:C.text2,marginBottom:"6px"}}>NEW PASSWORD</div>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}
              style={{width:"100%",boxSizing:"border-box",padding:"12px",background:C.bg,border:`1px solid ${C.border2}`,borderRadius:"4px",color:C.text,fontFamily:mono,outline:"none"}}/>
          </div>
          <div>
            <div style={{fontFamily:mono,fontSize:"0.6rem",color:C.text2,marginBottom:"6px"}}>CONFIRM PASSWORD</div>
            <input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} required minLength={6}
              style={{width:"100%",boxSizing:"border-box",padding:"12px",background:C.bg,border:`1px solid ${C.border2}`,borderRadius:"4px",color:C.text,fontFamily:mono,outline:"none"}}/>
          </div>
          <button type="submit" disabled={loading||done} style={{marginTop:"10px",padding:"14px",background:C.gold,color:C.bg,border:"none",borderRadius:"4px",fontFamily:mono,fontWeight:"700",cursor:"pointer",letterSpacing:"2px"}}>
            {loading ? "UPDATING..." : "UPDATE PASSWORD"}
          </button>
        </form>
      </div>
    </div>
  );
}

function AuthPage({ onAuthSuccess }) {
  const [email, setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState("");
  const [isLogin, setIsLogin]   = useState(true);
  const [resetSent, setResetSent] = useState(false);

  const handleForgotPassword = async () => {
    if (!email) { setError("Enter your email address first."); return; }
    setLoading(true); setError("");
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    setLoading(false);
    if (resetErr) { setError(resetErr.message); }
    else { setResetSent(true); setError(""); }
  };

  const handleAuth = async (e) => {
    e.preventDefault();
    setLoading(true); setError("");
    try {
      const { error: authErr } = isLogin
        ? await supabase.auth.signInWithPassword({ email, password })
        : await supabase.auth.signUp({ email, password });
      if (authErr) throw authErr;
      if (!isLogin) { setIsLogin(true); setError("Account created! Please log in."); }
      else onAuthSuccess();
    } catch(err) {
      if (!isLogin && (err.message.includes("already registered") || err.message.includes("already been registered"))) {
        setIsLogin(true);
        setError("Account exists. Please log in.");
      } else {
        setError(err.message);
      }
    }
    finally { setLoading(false); }
  };

  return (
    <div style={{flex:1,display:"flex",alignItems:"center",justifyContent:"center",background:C.bg}}>
      <div style={{width:"100%",maxWidth:"400px",padding:"40px",background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"8px"}}>
        <h2 style={{fontFamily:mono,fontSize:"1.5rem",marginBottom:"10px",textAlign:"center"}}>{isLogin?"WELCOME BACK":"CREATE ACCOUNT"}</h2>
        <p style={{fontFamily:mono,fontSize:"0.7rem",color:C.text2,textAlign:"center",marginBottom:"30px"}}>Enter your details to access the Studio.</p>
        
        {error && <div style={{padding:"10px",background:C.red+"22",color:C.red,border:`1px solid ${C.red}`,borderRadius:"4px",marginBottom:"20px",fontSize:"0.75rem"}}>{error}</div>}
        {resetSent && <div style={{padding:"10px",background:"#22553322",color:"#55cc88",border:"1px solid #55cc88",borderRadius:"4px",marginBottom:"20px",fontSize:"0.75rem"}}>Reset email sent! Check your inbox.</div>}
        
        <form onSubmit={handleAuth} style={{display:"flex",flexDirection:"column",gap:"16px"}}>
          <div>
            <div style={{fontFamily:mono,fontSize:"0.6rem",color:C.text2,marginBottom:"6px"}}>EMAIL ADDRESS</div>
            <input type="email" value={email} onChange={e=>setEmail(e.target.value)} required
              style={{width:"100%",boxSizing:"border-box",padding:"12px",background:C.bg,border:`1px solid ${C.border2}`,borderRadius:"4px",color:C.text,fontFamily:mono,outline:"none"}}/>
          </div>
          <div>
            <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:"6px"}}>
              <div style={{fontFamily:mono,fontSize:"0.6rem",color:C.text2}}>PASSWORD</div>
              {isLogin && <span onClick={handleForgotPassword} style={{fontFamily:mono,fontSize:"0.6rem",color:C.gold,cursor:"pointer",textDecoration:"underline"}}>Forgot password?</span>}
            </div>
            <input type="password" value={password} onChange={e=>setPassword(e.target.value)} required minLength={6}
              style={{width:"100%",boxSizing:"border-box",padding:"12px",background:C.bg,border:`1px solid ${C.border2}`,borderRadius:"4px",color:C.text,fontFamily:mono,outline:"none"}}/>
          </div>
          <button type="submit" disabled={loading} style={{marginTop:"10px",padding:"14px",background:C.gold,color:C.bg,border:"none",borderRadius:"4px",fontFamily:mono,fontWeight:"700",cursor:loading?"not-allowed":"pointer",letterSpacing:"2px"}}>
            {loading ? "PROCESSING..." : isLogin ? "LOG IN" : "SIGN UP"}
          </button>
        </form>
        
        <div style={{marginTop:"24px",textAlign:"center",fontFamily:mono,fontSize:"0.7rem",color:C.text3}}>
          {isLogin ? "Don't have an account? " : "Already have an account? "}
          <span onClick={()=>setIsLogin(!isLogin)} style={{color:C.gold,cursor:"pointer",textDecoration:"underline"}}>{isLogin?"Sign Up":"Log In"}</span>
        </div>
      </div>
    </div>
  );
}

function Profile({ session, onSignOut }) {
  const [videoCount, setVideoCount] = useState(null);
  const [tier,       setTier]       = useState(null);
  const [avatarUrl,  setAvatarUrl]  = useState(null);
  const [dispName,   setDispName]   = useState("");
  const [editingName,setEditingName]= useState(false);
  const [nameInput,  setNameInput]  = useState("");
  const [nameSaving, setNameSaving] = useState(false);
  const avatarRef = useRef();

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .from("generations")
      .select("id", { count: "exact", head: true })
      .eq("user_id", session.user.id)
      .then(({ count }) => setVideoCount(count ?? 0));
    supabase
      .from("profiles")
      .select("tier, avatar_url, full_name")
      .eq("id", session.user.id)
      .single()
      .then(({ data }) => {
        if (!data) return;
        if (data.tier)       setTier(data.tier.toUpperCase());
        if (data.avatar_url) setAvatarUrl(data.avatar_url);
        if (data.full_name)  { setDispName(data.full_name); setNameInput(data.full_name); }
      });
  }, [session?.user?.id]);

  const handleAvatarUpload = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    const ext  = file.name.split(".").pop();
    const path = `${session.user.id}/avatar.${ext}`;
    const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true });
    if (upErr) return;
    const { data: { publicUrl } } = supabase.storage.from("avatars").getPublicUrl(path);
    setAvatarUrl(publicUrl);
    await supabase.from("profiles").update({ avatar_url: publicUrl }).eq("id", session.user.id);
  };

  const saveName = async () => {
    if (!nameInput.trim()) return;
    setNameSaving(true);
    await supabase.from("profiles").update({ full_name: nameInput.trim() }).eq("id", session.user.id);
    setDispName(nameInput.trim()); setEditingName(false); setNameSaving(false);
  };

  const memberSince = session?.user?.created_at
    ? new Date(session.user.created_at).toLocaleDateString("en-US", { month:"short", year:"2-digit" }).replace(" ", " '")
    : "—";

  return (
    <div style={{flex:1,padding:"40px",overflowY:"auto",background:C.bg,display:"flex",justifyContent:"center"}}>
      <div style={{width:"100%",maxWidth:"600px"}}>
        <h2 style={{fontFamily:mono,fontSize:"1.5rem",marginBottom:"30px",letterSpacing:"2px",color:C.gold}}>USER PROFILE</h2>

        <div style={{background:C.bg2,border:`1px solid ${C.border}`,borderRadius:"6px",padding:"30px",marginBottom:"20px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"20px",marginBottom:"30px"}}>
            {/* Avatar — click to upload */}
            <div onClick={()=>avatarRef.current?.click()} title="Click to change avatar"
              style={{width:"60px",height:"60px",borderRadius:"50%",background:C.gold,display:"flex",alignItems:"center",justifyContent:"center",fontSize:"1.5rem",color:C.bg,fontWeight:"700",cursor:"pointer",overflow:"hidden",flexShrink:0}}>
              {avatarUrl
                ? <img src={avatarUrl} alt="avatar" style={{width:"100%",height:"100%",objectFit:"cover"}}/>
                : session?.user?.email?.[0].toUpperCase() || "?"}
            </div>
            <input ref={avatarRef} type="file" accept="image/jpeg,image/png,image/webp" capture="user" style={{display:"none"}} onChange={handleAvatarUpload}/>

            <div style={{flex:1,minWidth:0}}>
              {/* Editable display name */}
              {editingName
                ? <div style={{display:"flex",gap:"6px",marginBottom:"6px"}}>
                    <input autoFocus value={nameInput} onChange={e=>setNameInput(e.target.value)}
                      onKeyDown={e=>{ if(e.key==="Enter") saveName(); if(e.key==="Escape") setEditingName(false); }}
                      style={{flex:1,background:C.bg,border:`1px solid ${C.gold}`,borderRadius:"3px",padding:"4px 8px",fontFamily:mono,fontSize:"0.9rem",fontWeight:"700",color:C.text,outline:"none"}}/>
                    <button onClick={saveName} disabled={nameSaving} style={{padding:"4px 10px",background:C.gold,color:C.bg,border:"none",borderRadius:"3px",fontFamily:mono,fontWeight:"700",fontSize:"0.55rem",cursor:"pointer"}}>{nameSaving?"...":"SAVE"}</button>
                    <button onClick={()=>setEditingName(false)} style={{padding:"4px 8px",background:"transparent",color:C.text3,border:`1px solid ${C.border2}`,borderRadius:"3px",fontFamily:mono,fontSize:"0.55rem",cursor:"pointer"}}>✕</button>
                  </div>
                : <div onClick={()=>setEditingName(true)} title="Click to edit name"
                    style={{fontFamily:mono,fontSize:"1rem",fontWeight:"700",marginBottom:"4px",cursor:"pointer",display:"flex",alignItems:"center",gap:"6px"}}>
                    {dispName || session?.user?.email}
                    <span style={{fontSize:"0.55rem",color:C.text3}}>✎</span>
                  </div>
              }
              <div style={{fontFamily:mono,fontSize:"0.6rem",color:C.gold,padding:"2px 8px",background:"rgba(212,168,67,0.1)",border:`1px solid rgba(212,168,67,0.3)`,borderRadius:"10px",display:"inline-block"}}>{tier ? `${tier} TIER` : "—"}</div>
            </div>
          </div>

          <div style={{display:"flex",gap:"20px",borderTop:`1px solid ${C.border}`,paddingTop:"30px"}}>
            <div style={{flex:1}}>
              <div style={{fontFamily:mono,fontSize:"0.6rem",color:C.text3,marginBottom:"5px"}}>VIDEOS GENERATED</div>
              <div style={{fontFamily:mono,fontSize:"1.5rem",fontWeight:"700"}}>{videoCount ?? "—"}</div>
            </div>
            <div style={{flex:1}}>
              <div style={{fontFamily:mono,fontSize:"0.6rem",color:C.text3,marginBottom:"5px"}}>MEMBER SINCE</div>
              <div style={{fontFamily:mono,fontSize:"1.5rem",fontWeight:"700"}}>{memberSince}</div>
            </div>
          </div>
        </div>

        <button onClick={onSignOut} style={{padding:"12px 24px",background:"transparent",color:C.red,border:`1px solid ${C.red}`,borderRadius:"4px",fontFamily:mono,fontWeight:"700",cursor:"pointer",fontSize:"0.7rem",letterSpacing:"1px"}}>SIGN OUT</button>
      </div>
    </div>
  );
}

// ── ROOT ──────────────────────────────────────────────────────
export default function ChadStudioIO() {
  const [session,      setSession]      = useState(null);
  const [screen,       setScreen]       = useState("LANDING"); // LANDING, AUTH, STUDIO, PROFILE
  const [apiKey,       setApiKey]       = useState(() => localStorage.getItem("chadstudio_apikey") || "");
  const [showKeyInput, setShowKeyInput] = useState(false);
  const [studioData,   setStudioData]   = useState(null);
  const [studioView,   setStudioView]   = useState("GENERATOR"); // GENERATOR, ADVANCED STUDIO

  useEffect(() => {
    // Detect password reset redirect (hash contains type=recovery)
    const hash = window.location.hash;
    if (hash.includes("type=recovery")) {
      setScreen("RESET_PASSWORD");
      return;
    }
    // 6.9 Auth session management — run once on mount only
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      // 6.15 — on login, fetch API key from Supabase and populate state
      if (session?.user?.id) {
        supabase.from("profiles").select("api_key").eq("id", session.user.id).single()
          .then(({ data }) => { if (data?.api_key) setApiKey(data.api_key); });
      }
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, sess) => {
      setSession(sess);
      if (!sess) { setScreen("LANDING"); return; }
      // 6.15 — also fetch on auth state change (e.g. after email confirm)
      supabase.from("profiles").select("api_key").eq("id", sess.user.id).single()
        .then(({ data }) => { if (data?.api_key) setApiKey(data.api_key); });
    });
    return () => subscription.unsubscribe();
  }, []);

  // 6.15 — persist API key to Supabase when logged in, localStorage as fallback
  useEffect(() => {
    if (apiKey) localStorage.setItem("chadstudio_apikey", apiKey);
    else localStorage.removeItem("chadstudio_apikey");
    if (session?.user?.id) {
      supabase.from("profiles").update({ api_key: apiKey || null }).eq("id", session.user.id);
    }
  }, [apiKey, session?.user?.id]);

  const handleVideoReady = data => { setStudioData(data); setStudioView("ADVANCED STUDIO"); };
  const onSignOut = async () => { await supabase.auth.signOut(); setScreen("LANDING"); };

  return (
    <div style={{height:"100vh",background:C.bg,color:C.text,fontFamily:mono,display:"flex",flexDirection:"column",overflow:"hidden"}}>

      {/* NAV — hidden on landing (landing has its own nav) */}
      {screen !== "LANDING" && <nav style={{display:"flex",alignItems:"center",padding:"0 16px",height:"46px",borderBottom:`1px solid ${C.border}`,background:C.bg,flexShrink:0,gap:"20px"}}>
        <div onClick={()=>setScreen("LANDING")} style={{fontFamily:mono,fontWeight:"700",fontSize:"0.9rem",letterSpacing:"2px",cursor:"pointer"}}>
          <span style={{color:C.gold}}>CHAD</span><span style={{color:C.text}}>STUDIO</span><span style={{color:C.text3}}>.IO</span>
        </div>
        <div style={{display:"flex"}}>
          <button onClick={()=>{
             if (!session) setScreen("LANDING");
             else { setScreen("STUDIO"); setStudioView("GENERATOR"); }
          }} style={{
            padding:"6px 20px",fontSize:"0.56rem",letterSpacing:"2px",fontFamily:mono,fontWeight:"700",textTransform:"uppercase",
            border:"none",borderBottom:`2px solid ${screen==="STUDIO"&&studioView==="GENERATOR"?C.gold:"transparent"}`,
            background:"transparent",color:screen==="STUDIO"&&studioView==="GENERATOR"?C.gold:C.text3,cursor:"pointer",transition:"all 0.15s",
          }}>🎬 GENERATOR</button>
          
          <button onClick={()=>{
             if (!session) { alert("Please log in first."); return; }
             setScreen("STUDIO"); setStudioView("ADVANCED STUDIO");
          }} style={{
            padding:"6px 20px",fontSize:"0.56rem",letterSpacing:"2px",fontFamily:mono,fontWeight:"700",textTransform:"uppercase",
            border:"none",borderBottom:`2px solid ${screen==="STUDIO"&&studioView==="ADVANCED STUDIO"?C.gold:"transparent"}`,
            background:"transparent",color:screen==="STUDIO"&&studioView==="ADVANCED STUDIO"?C.gold:C.text3,cursor:"pointer",transition:"all 0.15s",
          }}>⚡ ADVANCED STUDIO</button>
        </div>
        <div style={{flex:1}}/>
        <div style={{display:"flex",alignItems:"center",gap:"15px"}}>
          <div style={{display:"flex",alignItems:"center",gap:"6px"}}>
            <div style={{width:"7px",height:"7px",borderRadius:"50%",background:apiKey.length>10?C.green:C.red}}/>
            <div style={{fontFamily:mono,fontSize:"0.48rem",letterSpacing:"1px",color:apiKey.length>10?C.green:C.red}}>
              {apiKey.length>10?"GOOGLE AI CONNECTED":"NOT CONNECTED"}
            </div>
          </div>
          {session ? (
            <button onClick={()=>setScreen("PROFILE")} style={{display:"flex",alignItems:"center",justifyContent:"center",width:"24px",height:"24px",borderRadius:"50%",background:C.gold,color:C.bg,border:"none",cursor:"pointer",fontFamily:mono,fontWeight:"700",fontSize:"0.6rem"}} title="Profile">
              {session.user.email[0].toUpperCase()}
            </button>
          ) : (
            <button onClick={()=>setScreen("AUTH")} style={{padding:"4px 12px",background:C.bg3,border:`1px solid ${C.border2}`,color:C.text2,fontFamily:mono,fontSize:"0.5rem",cursor:"pointer",borderRadius:"3px"}}>LOG IN</button>
          )}
        </div>
      </nav>}

      {/* STATUS BAR (Only in Studio) */}
      {screen==="STUDIO" && <StatusBar apiKey={apiKey} onChangeKey={()=>setShowKeyInput(s=>!s)}/>}

      {/* KEY INPUT DROPDOWN */}
      {showKeyInput && screen==="STUDIO" && (
        <div style={{padding:"10px 16px",background:C.bg4,borderBottom:`1px solid ${C.border}`,display:"flex",gap:"10px",alignItems:"center",flexShrink:0}}>
          <input type="password" placeholder="Paste your Google AI Studio API key..." value={apiKey} onChange={e=>setApiKey(e.target.value)}
            style={{flex:1,background:C.bg3,border:`1px solid ${apiKey.length>10?C.green:C.border2}`,borderRadius:"3px",padding:"8px 12px",fontFamily:mono,fontSize:"0.6rem",color:apiKey.length>10?C.green:C.text2,outline:"none"}}/>
          <button onClick={()=>setShowKeyInput(false)} style={{fontFamily:mono,fontSize:"0.55rem",color:C.text3,border:`1px solid ${C.border2}`,background:C.bg3,padding:"8px 14px",cursor:"pointer",borderRadius:"3px"}}>CLOSE</button>
        </div>
      )}

      {/* CONTENT LOGIC */}
      <div style={{flex:1,display:"flex",flexDirection:"column",overflow:"hidden"}}>
        {screen==="LANDING"         && <LandingPage onGetStarted={() => session ? setScreen("STUDIO") : setScreen("AUTH")} />}
        {screen==="AUTH"            && <AuthPage onAuthSuccess={() => setScreen("STUDIO")} />}
        {screen==="RESET_PASSWORD"  && <ResetPasswordPage onDone={() => { window.location.hash = ""; setScreen("AUTH"); }} />}
        {screen==="PROFILE"         && <Profile session={session} onSignOut={onSignOut} />}
        
        {screen==="STUDIO"  && studioView==="GENERATOR"       && <Generator apiKey={apiKey} onVideoReady={handleVideoReady}/>}
        {screen==="STUDIO"  && studioView==="ADVANCED STUDIO" && <AdvancedStudio studioData={studioData} apiKey={apiKey}/>}
      </div>

    </div>
  );
}
