import { useState } from "react";
import { supabase } from "./supabase";

const C = {
  bg:"#080808", bg2:"#0f0f0f", bg3:"#141414", bg4:"#1a1a1a",
  border:"#1e1e1e", border2:"#2a2a2a",
  gold:"#d4a843", goldBright:"#f0c040",
  text:"#e8e4dc", text2:"#8a8680", text3:"#444440",
  green:"#00e676", greenDim:"#0a2018",
  red:"#ff3d3d",
};
const mono = "'Courier New', Courier, monospace";

const PIPELINE = [
  { icon:"📁", name:"ASSET INGEST",     model:"Local → Memory"    },
  { icon:"🎙", name:"TRANSCRIBE",        model:"Gemini 2.5 Flash"  },
  { icon:"🧠", name:"PROMPT BUILD",      model:"Gemini 2.5 Flash"  },
  { icon:"🎬", name:"VIDEO GENERATE",    model:"Veo 3.1 Fast"      },
  { icon:"🔄", name:"SYNC ANALYSIS",     model:"Gemini 2.5 Flash"  },
  { icon:"🎥", name:"B-ROLL GENERATE",   model:"Veo 3.1 Fast"      },
  { icon:"🎞", name:"COMPOSE",           model:"Merge + Grade"     },
  { icon:"✅", name:"READY",             model:"Studio Unlock"     },
];

const FEATURES = [
  { icon:"🎤", title:"REAL LIP SYNC",    desc:"Gemini transcribes your audio. Veo locks mouth movements to every syllable." },
  { icon:"🧬", title:"FACE DNA",         desc:"Upload one front-facing photo. Your identity stays consistent across every clip." },
  { icon:"🎬", title:"ADVANCED STUDIO",  desc:"Timeline editor, FX panel, clip extend, audio tracks — all in one workspace." },
  { icon:"☁️", title:"CLOUD STORAGE",    desc:"Avatars auto-upload to Supabase. Share your Face DNA URL with anyone." },
];

// ── AUTH MODAL ────────────────────────────────────────────────
function AuthModal({ mode: initMode, onClose }) {
  const [mode,     setMode]     = useState(initMode);
  const [email,    setEmail]    = useState("");
  const [password, setPassword] = useState("");
  const [loading,  setLoading]  = useState(false);
  const [error,    setError]    = useState("");
  const [success,  setSuccess]  = useState("");

  const submit = async () => {
    setLoading(true); setError(""); setSuccess("");
    try {
      if (mode === "signup") {
        const { error } = await supabase.auth.signUp({ email, password });
        if (error) throw error;
        setSuccess("✓ Check your email to confirm your account.");
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        if (error) throw error;
        onClose();
      }
    } catch (e) { setError(e.message); }
    finally     { setLoading(false); }
  };

  return (
    <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.85)", display:"flex", alignItems:"center", justifyContent:"center", zIndex:1000 }}>
      <div onClick={e=>e.stopPropagation()} style={{ background:C.bg2, border:`1px solid ${C.border2}`, borderRadius:"4px", padding:"32px", width:"360px", display:"flex", flexDirection:"column", gap:"16px" }}>

        {/* HEADER */}
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontFamily:mono, fontSize:"0.8rem", fontWeight:"700", letterSpacing:"3px", color:C.gold }}>
            {mode==="signup" ? "CREATE ACCOUNT" : "SIGN IN"}
          </div>
          <button onClick={onClose} style={{ fontFamily:mono, fontSize:"0.7rem", color:C.text3, background:"transparent", border:"none", cursor:"pointer" }}>✕</button>
        </div>

        {/* TOGGLE */}
        <div style={{ display:"flex", gap:"0", border:`1px solid ${C.border2}`, borderRadius:"3px", overflow:"hidden" }}>
          {["signin","signup"].map(m=>(
            <button key={m} onClick={()=>{ setMode(m); setError(""); setSuccess(""); }} style={{
              flex:1, padding:"8px", fontFamily:mono, fontSize:"0.52rem", letterSpacing:"1px",
              background:mode===m?"rgba(212,168,67,0.15)":"transparent",
              color:mode===m?C.gold:C.text3, border:"none", cursor:"pointer",
            }}>
              {m==="signin"?"SIGN IN":"SIGN UP"}
            </button>
          ))}
        </div>

        {/* INPUTS */}
        <input type="email" placeholder="Email address" value={email} onChange={e=>setEmail(e.target.value)}
          style={{ background:C.bg3, border:`1px solid ${C.border2}`, borderRadius:"3px", padding:"10px 12px", fontFamily:mono, fontSize:"0.6rem", color:C.text, outline:"none" }}/>
        <input type="password" placeholder="Password" value={password} onChange={e=>setPassword(e.target.value)}
          onKeyDown={e=>e.key==="Enter"&&submit()}
          style={{ background:C.bg3, border:`1px solid ${C.border2}`, borderRadius:"3px", padding:"10px 12px", fontFamily:mono, fontSize:"0.6rem", color:C.text, outline:"none" }}/>

        {error   && <div style={{ fontFamily:mono, fontSize:"0.52rem", color:C.red }}>{error}</div>}
        {success && <div style={{ fontFamily:mono, fontSize:"0.52rem", color:C.green }}>{success}</div>}

        <button onClick={submit} disabled={loading || !email || !password} style={{
          padding:"12px", background:C.gold, border:"none", borderRadius:"3px",
          fontFamily:mono, fontWeight:"700", fontSize:"0.65rem", letterSpacing:"2px",
          color:C.bg, cursor:loading?"not-allowed":"pointer", opacity:loading?0.6:1,
        }}>
          {loading ? "..." : mode==="signup" ? "CREATE ACCOUNT" : "SIGN IN →"}
        </button>
      </div>
    </div>
  );
}

// ── LANDING PAGE ──────────────────────────────────────────────
export default function LandingPage() {
  const [showAuth, setShowAuth] = useState(false);
  const [authMode, setAuthMode] = useState("signin");

  const openAuth = mode => { setAuthMode(mode); setShowAuth(true); };

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:mono, overflowX:"hidden" }}>

      {/* NAV */}
      <nav style={{ position:"fixed", top:0, left:0, right:0, zIndex:100, height:"52px", background:"rgba(8,8,8,0.95)", borderBottom:`1px solid ${C.border}`, display:"flex", alignItems:"center", padding:"0 32px", gap:"24px" }}>
        <div style={{ fontWeight:"700", fontSize:"1rem", letterSpacing:"2px" }}>
          <span style={{ color:C.gold }}>CHAD</span><span style={{ color:C.text }}>STUDIO</span><span style={{ color:C.text3 }}>.IO</span>
        </div>
        <div style={{ flex:1 }}/>
        <button onClick={()=>openAuth("signin")} style={{ fontFamily:mono, fontSize:"0.52rem", letterSpacing:"1px", color:C.text2, background:"transparent", border:`1px solid ${C.border2}`, padding:"6px 16px", borderRadius:"2px", cursor:"pointer" }}>
          SIGN IN
        </button>
        <button onClick={()=>openAuth("signup")} style={{ fontFamily:mono, fontSize:"0.52rem", letterSpacing:"1px", color:C.bg, background:C.gold, border:"none", padding:"6px 16px", borderRadius:"2px", cursor:"pointer", fontWeight:"700" }}>
          GET STARTED
        </button>
      </nav>

      {/* HERO */}
      <section style={{ paddingTop:"140px", paddingBottom:"80px", textAlign:"center", maxWidth:"760px", margin:"0 auto", padding:"140px 24px 80px" }}>
        <div style={{ fontFamily:mono, fontSize:"0.6rem", letterSpacing:"4px", color:C.gold, marginBottom:"20px" }}>
          POWERED BY GOOGLE AI STUDIO · VEO 3.1 FAST · GEMINI 2.5 FLASH
        </div>
        <h1 style={{ fontFamily:mono, fontWeight:"700", fontSize:"clamp(1.8rem, 5vw, 3.2rem)", letterSpacing:"4px", lineHeight:1.15, color:C.text, margin:"0 0 24px" }}>
          CREATE AI MUSIC<br/><span style={{ color:C.gold }}>VIDEOS IN MINUTES</span>
        </h1>
        <p style={{ fontFamily:mono, fontSize:"0.65rem", color:C.text2, lineHeight:2, maxWidth:"520px", margin:"0 auto 40px", letterSpacing:"0.5px" }}>
          Upload your face, drop your track, describe the scene.<br/>
          Gemini transcribes. Veo generates. You direct.
        </p>
        <div style={{ display:"flex", gap:"12px", justifyContent:"center", flexWrap:"wrap" }}>
          <button onClick={()=>openAuth("signup")} style={{ fontFamily:mono, fontWeight:"700", fontSize:"0.7rem", letterSpacing:"3px", color:C.bg, background:C.gold, border:"none", padding:"14px 32px", borderRadius:"3px", cursor:"pointer" }}>
            ▶ START FREE
          </button>
          <button onClick={()=>openAuth("signin")} style={{ fontFamily:mono, fontSize:"0.7rem", letterSpacing:"3px", color:C.gold, background:"transparent", border:`1px solid ${C.gold}`, padding:"14px 32px", borderRadius:"3px", cursor:"pointer" }}>
            SIGN IN
          </button>
        </div>
      </section>

      {/* PIPELINE */}
      <section style={{ maxWidth:"960px", margin:"0 auto", padding:"0 24px 80px" }}>
        <div style={{ fontFamily:mono, fontSize:"0.52rem", letterSpacing:"4px", color:C.gold, textAlign:"center", marginBottom:"32px" }}>
          REAL AI PIPELINE — 8 STAGES
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))", gap:"8px" }}>
          {PIPELINE.map((p, i) => (
            <div key={p.name} style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:"3px", padding:"16px 12px", textAlign:"center" }}>
              <div style={{ fontSize:"1.4rem", marginBottom:"8px" }}>{p.icon}</div>
              <div style={{ fontFamily:mono, fontSize:"0.5rem", fontWeight:"700", color:C.text, letterSpacing:"1px", marginBottom:"4px" }}>
                <span style={{ color:C.gold, marginRight:"6px" }}>0{i+1}</span>{p.name}
              </div>
              <div style={{ fontFamily:mono, fontSize:"0.44rem", color:C.text3 }}>{p.model}</div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ maxWidth:"960px", margin:"0 auto", padding:"0 24px 80px" }}>
        <div style={{ fontFamily:mono, fontSize:"0.52rem", letterSpacing:"4px", color:C.gold, textAlign:"center", marginBottom:"32px" }}>
          BUILT FOR ARTISTS
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:"16px" }}>
          {FEATURES.map(f => (
            <div key={f.title} style={{ background:C.bg2, border:`1px solid ${C.border}`, borderRadius:"3px", padding:"24px 20px" }}>
              <div style={{ fontSize:"1.6rem", marginBottom:"12px" }}>{f.icon}</div>
              <div style={{ fontFamily:mono, fontSize:"0.6rem", fontWeight:"700", color:C.text, letterSpacing:"2px", marginBottom:"10px" }}>{f.title}</div>
              <div style={{ fontFamily:mono, fontSize:"0.52rem", color:C.text2, lineHeight:1.8 }}>{f.desc}</div>
            </div>
          ))}
        </div>
      </section>

      {/* CTA STRIP */}
      <section style={{ background:C.bg2, borderTop:`1px solid ${C.border}`, borderBottom:`1px solid ${C.border}`, padding:"60px 24px", textAlign:"center" }}>
        <div style={{ fontFamily:mono, fontWeight:"700", fontSize:"clamp(1.1rem, 3vw, 1.8rem)", letterSpacing:"3px", color:C.text, marginBottom:"24px" }}>
          YOUR MUSIC.<br/><span style={{ color:C.gold }}>YOUR FACE. YOUR VIDEO.</span>
        </div>
        <button onClick={()=>openAuth("signup")} style={{ fontFamily:mono, fontWeight:"700", fontSize:"0.7rem", letterSpacing:"3px", color:C.bg, background:C.gold, border:"none", padding:"16px 40px", borderRadius:"3px", cursor:"pointer" }}>
          GET STARTED FREE →
        </button>
      </section>

      {/* FOOTER */}
      <footer style={{ padding:"32px 24px", textAlign:"center", borderTop:`1px solid ${C.border}` }}>
        <div style={{ fontFamily:mono, fontWeight:"700", fontSize:"0.8rem", letterSpacing:"2px", marginBottom:"8px" }}>
          <span style={{ color:C.gold }}>CHAD</span><span style={{ color:C.text }}>STUDIO</span><span style={{ color:C.text3 }}>.IO</span>
        </div>
        <div style={{ fontFamily:mono, fontSize:"0.46rem", color:C.text3 }}>
          © 2026 ChadStudio.IO · Powered by Google AI Studio
        </div>
      </footer>

      {showAuth && <AuthModal mode={authMode} onClose={()=>setShowAuth(false)}/>}
    </div>
  );
}
