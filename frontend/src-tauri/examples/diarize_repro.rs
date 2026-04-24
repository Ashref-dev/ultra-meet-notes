use std::path::PathBuf;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    env_logger::Builder::from_default_env()
        .filter_level(log::LevelFilter::Info)
        .init();

    let audio = std::env::args().nth(1).expect("usage: diarize_repro <audio_path>");
    let audio_path = PathBuf::from(audio);
    println!("audio: {}", audio_path.display());

    let home = std::env::var("HOME")?;
    let seg = PathBuf::from(&home).join("Library/Application Support/tn.ashref.ultrameet/diarization/segmentation-3.0.onnx");
    let emb = PathBuf::from(&home).join("Library/Application Support/tn.ashref.ultrameet/diarization/wespeaker_en_voxceleb_CAM++.onnx");
    println!("seg model: {} ({} bytes)", seg.display(), std::fs::metadata(&seg)?.len());
    println!("emb model: {} ({} bytes)", emb.display(), std::fs::metadata(&emb)?.len());

    println!("--- decoding audio ---");
    let decoded = app_lib::audio::decoder::decode_audio_file(&audio_path)?;
    println!(
        "decoded: {} samples @ {}Hz, {} ch, {:.2}s",
        decoded.samples.len(),
        decoded.sample_rate,
        decoded.channels,
        decoded.duration_seconds
    );

    let pcm = decoded.to_whisper_format();
    println!("16k mono pcm: {} samples ({:.2}s)", pcm.len(), pcm.len() as f32 / 16000.0);

    println!("--- init Diarize ---");
    let config = sherpa_rs::diarize::DiarizeConfig {
        num_clusters: Some(0),
        threshold: Some(0.5),
        min_duration_on: Some(0.3),
        min_duration_off: Some(0.5),
        provider: Some("cpu".to_string()),
        debug: true,
    };

    let mut diarizer = sherpa_rs::diarize::Diarize::new(&seg, &emb, config)
        .map_err(|e| format!("Diarize::new failed: {}", e))?;
    println!("Diarize::new OK");

    println!("--- compute ---");
    let segments = diarizer.compute(pcm, None)
        .map_err(|e| format!("compute failed: {}", e))?;
    println!("got {} segments", segments.len());
    for s in &segments {
        println!("  {:.2}-{:.2}s speaker={}", s.start, s.end, s.speaker);
    }

    Ok(())
}
