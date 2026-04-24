// qwen3_asr_c.cpp
//
// C wrapper around the qwen3-asr.cpp C++ library.
// Provides extern "C" functions for Rust FFI.

#include "qwen3_asr_c.h"

#include <cstring>
#include <cstdlib>
#include <string>
#include <chrono>

#ifdef QWEN3_ASR_HAS_VENDOR
#include "qwen3_asr.h"
#else
// Stub implementation for compilation without vendor library
struct Qwen3ASRModel {
    bool loaded;
    std::string model_path;
};
#endif

struct qwen3_asr_context {
#ifdef QWEN3_ASR_HAS_VENDOR
    qwen3_asr::Qwen3ASR* model;
#else
    Qwen3ASRModel* model;
#endif
    bool model_loaded;
};

static char* strdup_safe(const std::string& s) {
    char* out = (char*)malloc(s.size() + 1);
    if (out) {
        memcpy(out, s.c_str(), s.size() + 1);
    }
    return out;
}

extern "C" {

struct qwen3_asr_params qwen3_asr_default_params(void) {
    struct qwen3_asr_params params;
    params.n_threads = 0;       // auto-detect
    params.use_gpu = true;
    params.gpu_device = 0;
    params.temperature = 0.0f;  // greedy decoding
    return params;
}

qwen3_asr_context* qwen3_asr_init(void) {
    auto* ctx = new qwen3_asr_context();
    ctx->model = nullptr;
    ctx->model_loaded = false;
    return ctx;
}

bool qwen3_asr_load_model(qwen3_asr_context* ctx, const char* model_path) {
    if (!ctx || !model_path) return false;

#ifdef QWEN3_ASR_HAS_VENDOR
    // Free previous model if any
    if (ctx->model) {
        delete ctx->model;
        ctx->model = nullptr;
        ctx->model_loaded = false;
    }

    ctx->model = new qwen3_asr::Qwen3ASR();
    bool ok = ctx->model->load_model(std::string(model_path));
    ctx->model_loaded = ok;

    if (!ok) {
        delete ctx->model;
        ctx->model = nullptr;
    }

    return ok;
#else
    // Stub: validate the file exists (basic check)
    FILE* f = fopen(model_path, "rb");
    if (!f) return false;

    // Check GGUF magic header: 0x46475547 ("GGUF" in little-endian)
    uint32_t magic = 0;
    if (fread(&magic, sizeof(magic), 1, f) != 1) {
        fclose(f);
        return false;
    }
    fclose(f);

    if (magic != 0x46475547) {
        return false;  // Not a valid GGUF file
    }

    auto* model = new Qwen3ASRModel();
    model->loaded = true;
    model->model_path = model_path;
    ctx->model = model;
    ctx->model_loaded = true;
    return true;
#endif
}

struct qwen3_asr_result qwen3_asr_transcribe(
    qwen3_asr_context* ctx,
    const float* samples,
    int32_t n_samples,
    struct qwen3_asr_params params
) {
    struct qwen3_asr_result result;
    result.text = nullptr;
    result.n_tokens = 0;
    result.duration_ms = 0.0f;
    result.success = false;

    if (!ctx || !ctx->model_loaded || !samples || n_samples <= 0) {
        return result;
    }

    auto start = std::chrono::high_resolution_clock::now();

#ifdef QWEN3_ASR_HAS_VENDOR
    qwen3_asr::transcribe_params tp;
    tp.n_threads = params.n_threads > 0 ? params.n_threads : 4;
    tp.print_progress = false;
    tp.print_timing = false;

    auto res = ctx->model->transcribe(samples, n_samples, tp);
    result.text = strdup_safe(res.text);
    result.n_tokens = (int32_t)res.tokens.size();
    result.success = res.success;
#else
    // Stub: return placeholder
    float duration_sec = (float)n_samples / 16000.0f;
    std::string stub_text = "[Qwen3-ASR stub: " + std::to_string(n_samples) +
                           " samples, " + std::to_string(duration_sec) + "s audio]";
    result.text = strdup_safe(stub_text);
    result.n_tokens = 1;
    result.success = true;
#endif

    auto end = std::chrono::high_resolution_clock::now();
    result.duration_ms = std::chrono::duration<float, std::milli>(end - start).count();

    return result;
}

struct qwen3_asr_result qwen3_asr_transcribe_streaming(
    qwen3_asr_context* ctx,
    const float* samples,
    int32_t n_samples,
    struct qwen3_asr_params params,
    qwen3_asr_token_callback callback,
    void* user_data
) {
    struct qwen3_asr_result result;
    result.text = nullptr;
    result.n_tokens = 0;
    result.duration_ms = 0.0f;
    result.success = false;

    if (!ctx || !ctx->model_loaded || !samples || n_samples <= 0) {
        return result;
    }

    auto start = std::chrono::high_resolution_clock::now();

#ifdef QWEN3_ASR_HAS_VENDOR
    // The vendor's progress_callback gives (tokens_generated, max_tokens), not token text.
    // Use batch mode and call the callback once with the full result.
    qwen3_asr::transcribe_params tp;
    tp.n_threads = params.n_threads > 0 ? params.n_threads : 4;
    tp.print_progress = false;
    tp.print_timing = false;

    auto res = ctx->model->transcribe(samples, n_samples, tp);
    if (res.success && callback) {
        callback(res.text.c_str(), user_data);
    }
    result.text = strdup_safe(res.text);
    result.n_tokens = (int32_t)res.tokens.size();
    result.success = res.success;
#else
    // Stub: emit a few tokens via callback, then return full text
    std::string full_text;
    const char* stub_tokens[] = {"[Qwen3", "-ASR", " streaming", " stub]"};
    int n_stub_tokens = 4;

    for (int i = 0; i < n_stub_tokens; i++) {
        if (callback) {
            bool should_continue = callback(stub_tokens[i], user_data);
            if (!should_continue) break;
        }
        full_text += stub_tokens[i];
        result.n_tokens++;
    }

    result.text = strdup_safe(full_text);
    result.success = true;
#endif

    auto end = std::chrono::high_resolution_clock::now();
    result.duration_ms = std::chrono::duration<float, std::milli>(end - start).count();

    return result;
}

bool qwen3_asr_is_model_loaded(const qwen3_asr_context* ctx) {
    if (!ctx) return false;
    return ctx->model_loaded;
}

void qwen3_asr_free(qwen3_asr_context* ctx) {
    if (!ctx) return;

#ifdef QWEN3_ASR_HAS_VENDOR
    if (ctx->model) {
        delete ctx->model;
        ctx->model = nullptr;
    }
#else
    if (ctx->model) {
        delete ctx->model;
    }
#endif

    delete ctx;
}

void qwen3_asr_free_text(char* text) {
    free(text);
}

} // extern "C"
