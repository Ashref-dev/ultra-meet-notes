use crate::api::{TranscriptSearchResult, TranscriptSegment};
use crate::audio::transcription::WordTimestamp;
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqlitePool};
use tracing::{error, info};
use uuid::Uuid;

pub struct TranscriptsRepository;

#[derive(Debug, Clone)]
pub struct NewTranscriptRow {
    pub meeting_id: String,
    pub text: String,
    pub timestamp: String,
    pub audio_start_time: Option<f64>,
    pub audio_end_time: Option<f64>,
    pub duration: Option<f64>,
    pub speaker: Option<String>,
    pub words: Option<Vec<WordTimestamp>>,
}

impl TranscriptsRepository {
    /// Saves a new meeting and its associated transcript segments.
    /// This function uses a transaction to ensure that either both the meeting
    /// and all its transcripts are saved, or none of them are.
    pub async fn save_transcript(
        pool: &SqlitePool,
        meeting_title: &str,
        transcripts: &[TranscriptSegment],
        folder_path: Option<String>,
    ) -> Result<String, SqlxError> {
        let meeting_id = format!("meeting-{}", Uuid::new_v4());

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now();

        // 1. Create the new meeting
        let result = sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&meeting_id)
        .bind(meeting_title)
        .bind(now)
        .bind(now)
        .bind(&folder_path)
        .execute(&mut *transaction)
        .await;

        if let Err(e) = result {
            error!("Failed to create meeting '{}': {}", meeting_title, e);
            transaction.rollback().await?;
            return Err(e);
        }

        info!("Successfully created meeting with id: {}", meeting_id);

        for segment in transcripts {
            let transcript_id = format!("transcript-{}", Uuid::new_v4());
            let result = sqlx::query(
                "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration, speaker, words)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&transcript_id)
            .bind(&meeting_id)
            .bind(&segment.text)
            .bind(&segment.timestamp)
            .bind(segment.audio_start_time)
            .bind(segment.audio_end_time)
            .bind(segment.duration)
            .bind(&segment.speaker)
            .bind(Self::serialize_words(segment.words.as_ref())?)
            .execute(&mut *transaction)
            .await;

            if let Err(e) = result {
                error!(
                    "Failed to save transcript segment for meeting {}: {}",
                    meeting_id, e
                );
                transaction.rollback().await?;
                return Err(e);
            }
        }

        info!(
            "Successfully saved {} transcript segments for meeting {}",
            transcripts.len(),
            meeting_id
        );

        // Commit the transaction
        transaction.commit().await?;

        Ok(meeting_id)
    }

    pub async fn list_by_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<crate::database::models::Transcript>, SqlxError> {
        let rows = sqlx::query_as::<
            _,
            (
                String,
                String,
                String,
                String,
                Option<String>,
                Option<String>,
                Option<String>,
                Option<f64>,
                Option<f64>,
                Option<f64>,
                Option<String>,
                Option<String>,
            ),
        >(
            "SELECT id, meeting_id, transcript, timestamp, summary, action_items, key_points,
                    audio_start_time, audio_end_time, duration, speaker, words
             FROM transcripts
             WHERE meeting_id = ?
             ORDER BY COALESCE(audio_start_time, 0) ASC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await?;

        rows
            .into_iter()
            .map(
                |(
                    id,
                    meeting_id,
                    transcript,
                    timestamp,
                    summary,
                    action_items,
                    key_points,
                    audio_start_time,
                    audio_end_time,
                    duration,
                    speaker,
                    words,
                )| {
                    Ok(crate::database::models::Transcript {
                        id,
                        meeting_id,
                        transcript,
                        timestamp,
                        summary,
                        action_items,
                        key_points,
                        audio_start_time,
                        audio_end_time,
                        duration,
                        speaker,
                        words: Self::deserialize_words(words)?,
                    })
                },
            )
            .collect()
    }

    pub async fn update_speaker_for_ids(
        pool: &SqlitePool,
        updates: &[(String, Option<String>)],
    ) -> Result<usize, SqlxError> {
        if updates.is_empty() {
            return Ok(0);
        }

        let mut conn = pool.acquire().await?;
        let mut tx = conn.begin().await?;
        let mut count = 0usize;

        for (transcript_id, speaker) in updates {
            sqlx::query("UPDATE transcripts SET speaker = ? WHERE id = ?")
                .bind(speaker)
                .bind(transcript_id)
                .execute(&mut *tx)
                .await?;
            count += 1;
        }

        tx.commit().await?;
        Ok(count)
    }

    pub async fn replace_transcript_with_split_rows(
        pool: &SqlitePool,
        meeting_id: &str,
        original_id: &str,
        new_rows: Vec<NewTranscriptRow>,
    ) -> Result<Vec<String>, SqlxError> {
        let mut conn = pool.acquire().await?;
        let mut tx = conn.begin().await?;

        sqlx::query("DELETE FROM transcripts WHERE id = ? AND meeting_id = ?")
            .bind(original_id)
            .bind(meeting_id)
            .execute(&mut *tx)
            .await?;

        let mut inserted_ids = Vec::with_capacity(new_rows.len());
        for row in new_rows {
            let transcript_id = format!("transcript-{}", Uuid::new_v4());
            sqlx::query(
                "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration, speaker, words)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            )
            .bind(&transcript_id)
            .bind(&row.meeting_id)
            .bind(&row.text)
            .bind(&row.timestamp)
            .bind(row.audio_start_time)
            .bind(row.audio_end_time)
            .bind(row.duration)
            .bind(&row.speaker)
            .bind(Self::serialize_words(row.words.as_ref())?)
            .execute(&mut *tx)
            .await?;

            inserted_ids.push(transcript_id);
        }

        tx.commit().await?;
        Ok(inserted_ids)
    }

    pub async fn search_transcripts(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<TranscriptSearchResult>, SqlxError> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        let search_query = format!("%{}%", query.to_lowercase());

        let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT m.id, m.title, t.transcript, t.timestamp
             FROM meetings m
             JOIN transcripts t ON m.id = t.meeting_id
             WHERE LOWER(t.transcript) LIKE ?",
        )
        .bind(&search_query)
        .fetch_all(pool)
        .await?;

        let results = rows
            .into_iter()
            .map(|(id, title, transcript, timestamp)| {
                let match_context = Self::get_match_context(&transcript, query);
                TranscriptSearchResult {
                    id,
                    title,
                    match_context,
                    timestamp,
                }
            })
            .collect();

        Ok(results)
    }

    /// Helper function to extract a snippet of text around the first match of a query.
    fn get_match_context(transcript: &str, query: &str) -> String {
        let transcript_lower = transcript.to_lowercase();
        let query_lower = query.to_lowercase();

        match transcript_lower.find(&query_lower) {
            Some(match_index) => {
                let start_index = match_index.saturating_sub(100);
                let end_index = (match_index + query.len() + 100).min(transcript.len());

                let mut context = String::new();
                if start_index > 0 {
                    context.push_str("...");
                }
                context.push_str(&transcript[start_index..end_index]);
                if end_index < transcript.len() {
                    context.push_str("...");
                }
                context
            }
            None => transcript.chars().take(200).collect(), // Fallback to the start of the transcript
        }
    }

    fn serialize_words(words: Option<&Vec<WordTimestamp>>) -> Result<Option<String>, SqlxError> {
        words
            .map(serde_json::to_string)
            .transpose()
            .map_err(|e| SqlxError::Protocol(format!("Failed to serialize transcript words: {}", e)))
    }

    fn deserialize_words(words_json: Option<String>) -> Result<Option<Vec<WordTimestamp>>, SqlxError> {
        words_json
            .map(|json| serde_json::from_str::<Vec<WordTimestamp>>(&json))
            .transpose()
            .map_err(|e| SqlxError::Protocol(format!("Failed to deserialize transcript words: {}", e)))
    }
}
