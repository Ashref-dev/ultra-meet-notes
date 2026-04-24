#ifndef QWEN3_ASR_C_H
#define QWEN3_ASR_C_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

// Opaque context handle
typedef struct qwen3_asr_context qwen3_asr_context;

// Transcription parameters
struct qwen3_asr_params {
    int32_t n_threads;     // Number of threads (0 = auto)
    bool    use_gpu;       // Enable GPU acceleration
    int32_t gpu_device;    // GPU device index
    float   temperature;   // Sampling temperature (0.0 = greedy)
};

// Transcription result
struct qwen3_asr_result {
    char*   text;          // Transcribed text (caller must free with qwen3_asr_free_text)
    int32_t n_tokens;      // Number of tokens generated
    float   duration_ms;   // Processing time in milliseconds
    bool    success;       // Whether transcription succeeded
};

// Streaming token callback
// Called for each token during streaming transcription.
// token: the decoded token text (null-terminated, valid only during callback)
// user_data: opaque pointer passed through from transcribe_streaming
// Returns: true to continue, false to abort
typedef bool (*qwen3_asr_token_callback)(const char* token, void* user_data);

// Get default parameters
struct qwen3_asr_params qwen3_asr_default_params(void);

// Create a new ASR context
qwen3_asr_context* qwen3_asr_init(void);

// Load a GGUF model file
// Returns true on success
bool qwen3_asr_load_model(qwen3_asr_context* ctx, const char* model_path);

// Transcribe audio samples (batch mode)
// samples: pointer to float32 PCM audio at 16kHz mono
// n_samples: number of samples
// params: transcription parameters
struct qwen3_asr_result qwen3_asr_transcribe(
    qwen3_asr_context* ctx,
    const float* samples,
    int32_t n_samples,
    struct qwen3_asr_params params
);

// Transcribe audio samples with streaming token output
// callback is invoked for each decoded token
struct qwen3_asr_result qwen3_asr_transcribe_streaming(
    qwen3_asr_context* ctx,
    const float* samples,
    int32_t n_samples,
    struct qwen3_asr_params params,
    qwen3_asr_token_callback callback,
    void* user_data
);

// Check if a model is loaded
bool qwen3_asr_is_model_loaded(const qwen3_asr_context* ctx);

// Free the ASR context
void qwen3_asr_free(qwen3_asr_context* ctx);

// Free text returned by qwen3_asr_result
void qwen3_asr_free_text(char* text);

#ifdef __cplusplus
}
#endif

#endif // QWEN3_ASR_C_H
