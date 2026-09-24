import {useEffect, useRef, useState} from "react";
import {createRoot} from "react-dom/client";
import {SegmentItem} from "../src/components/SegmentItem";
import {usePlayback} from "../src/hooks/usePlayback";
import type {ParagraphEditorElement} from "../src/lib/paragraphEditor";
import type {Transcript} from "../src/types";
import "../src/styles.css";

export function PlaybackEditingCheck() {
  const [transcript, setTranscript] = useState<Transcript>({audio:{filename:"test.wav",duration:120},speakers:[{id:"s",name:"测试"}],segments:[
    {id:"test",speaker_id:"s",start:0,end:120,text:"test 后面的音频继续播放",words:[{text:"test",start:0,end:4},{text:" 后面的音频继续播放",start:4,end:120}]},
  ]});
  const [showMarks,setShowMarks]=useState(false);
  const [showComparison,setShowComparison]=useState(false);
  const [selected,setSelected]=useState("test");
  const [active,setActive]=useState("");
  const registry=useRef(new Map<string,ParagraphEditorElement>());
  const editing=useRef(false);
  const {audioRef,audioUrl,currentTime,isPlaying,setIsPlaying,togglePlayback,updateCurrentSegment,seekTo,recordEditorCursor,setAudioUrl}=usePlayback({transcript,mutateTranscript:updater=>setTranscript(updater),activeSegmentId:active,setActiveSegmentId:setActive,
    effectiveSelectedSegmentId:selected,setSelectedSegmentId:setSelected,textareaRefs:registry,setLoadError:console.error});
  useEffect(()=>{
    const data=new Uint8Array(44+8000*120*2);const view=new DataView(data.buffer);
    const text=(offset:number,value:string)=>Array.from(value).forEach((c,i)=>view.setUint8(offset+i,c.charCodeAt(0)));
    text(0,"RIFF");view.setUint32(4,data.length-8,true);text(8,"WAVEfmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,8000,true);view.setUint32(28,16000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,"data");view.setUint32(40,data.length-44,true);
    setAudioUrl(URL.createObjectURL(new Blob([data],{type:"audio/wav"})));
  },[setAudioUrl]);
  const noop=()=>{};
  return <main style={{margin:30,maxWidth:900}}><h1>播放中编辑测试（静音测试音频）</h1>
    <audio ref={audioRef} src={audioUrl || undefined} onTimeUpdate={updateCurrentSegment} onPlay={()=>setIsPlaying(true)} onPause={()=>setIsPlaying(false)}/>
    <button onClick={togglePlayback}>{isPlaying?"暂停":"播放"}</button>
    <label><input type="checkbox" checked={showMarks} onChange={e=>setShowMarks(e.target.checked)}/>手工高亮叠加</label>
    <label><input type="checkbox" checked={showComparison} onChange={e=>setShowComparison(e.target.checked)}/>修改痕迹叠加</label>
    <p>进度：{currentTime.toFixed(2)}；{isPlaying?"播放中":"已暂停"}</p>
    <SegmentItem segment={{...transcript.segments[0],highlights:showMarks?[{id:"qa-mark",start:0,end:8}]:[]}} comparisonBefore={showComparison?"test 原来后面的音频继续播放":undefined} index={0} totalSegments={1} speakers={transcript.speakers} effectiveSelectedSegmentId={selected}
      isPlaying={isPlaying} currentTime={currentTime} audioUrl={audioUrl} audioRef={audioRef} textareaRefs={registry} editingRef={editing}
      findQuery="" viewingOriginal={false} setSelectedSegmentId={setSelected} seekTo={seekTo} recordEditorCursor={recordEditorCursor}
      addSpeaker={noop} removeSegment={noop} splitSegment={noop} mergeWithNext={noop} handleEditorKeydown={noop}
      updateSegment={(id,changes)=>setTranscript(t=>({...t,segments:t.segments.map(s=>s.id===id?{...s,...changes}:s)}))}/>
    <p>高亮支持：{typeof CSS !== "undefined" && CSS.highlights && typeof Highlight !== "undefined" ? "是" : "否"}；高亮范围：{typeof CSS !== "undefined" && CSS.highlights ? CSS.highlights.get("transcript-playback")?.size ?? 0 : 0}</p>
    <p>已提交正文：{transcript.segments[0].text}</p>
  </main>;
}
createRoot(document.getElementById("root")!).render(<PlaybackEditingCheck/>);
