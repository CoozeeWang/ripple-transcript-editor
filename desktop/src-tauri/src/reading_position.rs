//! Small local view preferences, flushed before normal exit; never manuscript IO.
use tauri::Manager;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, io::Write, path::Path, sync::Mutex};
static LOCK: Mutex<()> = Mutex::new(());
#[derive(Clone, Serialize, Deserialize)]
pub struct Anchor { id:String,index:u64,paragraph:i64,offset:f64,fraction:f64 }
fn valid(a:&Anchor)->bool { !a.id.is_empty()&&a.id.len()<=200&&a.paragraph>=-1&&a.offset.is_finite()&&a.offset>=0.0&&a.fraction.is_finite()&&(0.0..=1.0).contains(&a.fraction) }
fn key(value:&str)->Result<String,String>{if !value.starts_with("ripple-reading-position-v1:")||value.len()>4096{return Err("invalid_reading_key".into())}Ok(format!("{:x}",Sha256::digest(value.as_bytes())))}
fn read(path:&Path)->Result<BTreeMap<String,Anchor>,String>{
 match fs::read(path){Ok(bytes)=>serde_json::from_slice(&bytes).map_err(|_|"reading_preference_invalid".into()),Err(e)if e.kind()==std::io::ErrorKind::NotFound=>Ok(BTreeMap::new()),Err(_)=>Err("reading_preference_unavailable".into())}
}
fn store(path:&Path,k:String,a:Anchor)->Result<(),String>{
 if !valid(&a){return Err("invalid_reading_anchor".into())}
 let mut values=read(path)?;if values.len()>=1000&&!values.contains_key(&k){if let Some(first)=values.keys().next().cloned(){values.remove(&first);}}
 values.insert(k,a);let bytes=serde_json::to_vec(&values).map_err(|_|"reading_preference_invalid")?;
 let parent=path.parent().ok_or("reading_preference_unavailable")?;fs::create_dir_all(parent).map_err(|_|"reading_preference_unavailable")?;
 let temporary=path.with_extension("tmp");
 let result:Result<(),String>=(||{let mut f=fs::File::create(&temporary)?;f.write_all(&bytes)?;f.sync_all()?;fs::rename(&temporary,path)})().map_err(|_:std::io::Error|"reading_preference_save_failed".into());
 if result.is_err(){let _=fs::remove_file(&temporary);}result
}
#[tauri::command]
pub fn reading_position_read(window:tauri::WebviewWindow,key_value:String)->Result<Option<Anchor>,String>{
 if !crate::pdf_print::main_window(window.label()){return Err("main_window_required".into())}
 let _lock=LOCK.lock().map_err(|_|"reading_preference_unavailable")?;
 let path=crate::app_data(window.app_handle())?.join("reading-positions-v1.json");let k=key(&key_value)?;
 Ok(read(&path)?.remove(&k).filter(valid))
}
#[tauri::command]
pub fn reading_position_write(window:tauri::WebviewWindow,key_value:String,anchor:Anchor)->Result<(),String>{
 if !crate::pdf_print::main_window(window.label()){return Err("main_window_required".into())}
 let _lock=LOCK.lock().map_err(|_|"reading_preference_unavailable")?;
 store(&crate::app_data(window.app_handle())?.join("reading-positions-v1.json"),key(&key_value)?,anchor)
}
#[cfg(test)] mod tests{
 use super::*;
 #[test]fn exact_keys_are_bounded_and_do_not_become_paths(){assert!(key("../../other").is_err());assert_ne!(key("ripple-reading-position-v1:a").unwrap(),key("ripple-reading-position-v1:b").unwrap());}
 #[test]fn flush_survives_reopen_and_retains_other_versions(){let dir=std::env::temp_dir().join(format!("ripple-reading-{}",std::process::id()));let path=dir.join("reading.json");let a=Anchor{id:"synthetic".into(),index:2,paragraph:0,offset:4.0,fraction:0.5};store(&path,"a".into(),a.clone()).unwrap();store(&path,"b".into(),a).unwrap();let loaded=read(&path).unwrap();assert_eq!(loaded.len(),2);assert_eq!(loaded["a"].index,2);let _=fs::remove_dir_all(dir);}
 #[test]fn rejects_invalid_geometry(){assert!(!valid(&Anchor{id:"synthetic".into(),index:0,paragraph:0,offset:0.0,fraction:2.0}));}
}
