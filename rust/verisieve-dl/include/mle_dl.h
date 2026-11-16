#ifndef MLE_DL_H
#define MLE_DL_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

/* Core ABI & Linear Memory Allocation */
uint32_t mle_dl_abi_version(void);
uint8_t *mle_dl_alloc(size_t size);
void mle_dl_free(uint8_t *ptr, size_t size);

/* Kernel Family 1: Subword Matryoshka Embeddings & BitNet b1.58 Encoder */
void mle_dl_embed_subword(
    const uint8_t *text_bytes, size_t total_bytes,
    const uint32_t *offsets, size_t n_rows,
    float *out, size_t dim, size_t max_dim, uint32_t seed);

size_t mle_dl_bitnet_packed_bytes(size_t d_model, size_t n_layers);
size_t mle_dl_bitnet_scale_count(size_t n_layers);
void mle_dl_bitnet_init(
    uint8_t *packed_out, float *scales_out,
    size_t d_model, size_t n_layers, uint32_t seed);
void mle_dl_bitnet_encode(
    const uint8_t *text_bytes, size_t total_bytes,
    const uint32_t *offsets, size_t n_rows,
    const uint8_t *packed_w, const float *scales,
    size_t d_model, size_t n_heads, size_t n_layers, size_t max_seq,
    float *out, size_t dim, uint32_t seed);

/* Kernel Family 2: Tabular / Embedding Residual Network (ResNet) */
size_t mle_dl_resnet_param_count(
    size_t f, size_t d_model, size_t n_layers, size_t n_out);
void mle_dl_resnet_init(
    float *params, size_t f, size_t d_model, size_t n_layers,
    size_t n_out, uint32_t seed);
float mle_dl_resnet_loss_grad(
    const float *x, const float *y, const float *params, float *grads,
    size_t n, size_t f, size_t d_model, size_t n_layers,
    uint32_t task, size_t n_out, float dropout, uint32_t seed);
float mle_dl_resnet_train(
    const float *x, const float *y, float *params,
    size_t n, size_t f, size_t d_model, size_t n_layers,
    uint32_t task, size_t n_out, size_t epochs, size_t batch_size,
    float lr, float weight_decay, float dropout, uint32_t seed);
void mle_dl_resnet_predict(
    const float *x, const float *params, float *out,
    size_t n, size_t f, size_t d_model, size_t n_layers,
    uint32_t task, size_t n_out);

/* Kernel Family 3: Dual-Mode Self-Attention (FT-Transformer + Patch Transformer) */
size_t mle_dl_transformer_param_count(
    size_t f, size_t seq_len, size_t patch_dim,
    size_t d_model, size_t n_layers, size_t n_out);
void mle_dl_transformer_init(
    float *params, size_t f, size_t seq_len, size_t patch_dim,
    size_t d_model, size_t n_layers, size_t n_out, uint32_t seed);
float mle_dl_transformer_loss_grad(
    const float *x, const float *y, const float *params, float *grads,
    size_t n, size_t f, size_t seq_len, size_t patch_dim,
    size_t d_model, size_t n_heads, size_t n_layers,
    uint32_t task, size_t n_out);
float mle_dl_transformer_train(
    const float *x, const float *y, float *params,
    size_t n, size_t f, size_t seq_len, size_t patch_dim,
    size_t d_model, size_t n_heads, size_t n_layers,
    uint32_t task, size_t n_out, size_t epochs, size_t batch_size,
    float lr, float weight_decay, uint32_t seed);
void mle_dl_transformer_predict(
    const float *x, const float *params, float *out,
    size_t n, size_t f, size_t seq_len, size_t patch_dim,
    size_t d_model, size_t n_heads, size_t n_layers,
    uint32_t task, size_t n_out);

/* Kernel Family 4: VeRA Fine-Tuning over Frozen 2-bit BitNet b1.58 Backbone */
size_t mle_dl_vera_backbone_bytes(
    size_t f, size_t d_model, size_t n_layers);
size_t mle_dl_vera_scale_count(size_t n_layers);
void mle_dl_vera_init_backbone(
    uint8_t *packed_out, float *scales_out,
    size_t f, size_t d_model, size_t n_layers, uint32_t backbone_seed);
size_t mle_dl_vera_param_count(
    size_t d_model, size_t n_layers, size_t rank, size_t n_out);
void mle_dl_vera_init_params(
    float *params, size_t d_model, size_t n_layers,
    size_t rank, size_t n_out, uint32_t seed);
float mle_dl_vera_loss_grad(
    const float *x, const float *y,
    const uint8_t *packed_backbone, const float *scales,
    const float *params, float *grads,
    size_t n, size_t f, size_t d_model, size_t n_layers, size_t rank,
    uint32_t task, size_t n_out, uint32_t backbone_seed);
float mle_dl_vera_train(
    const float *x, const float *y,
    const uint8_t *packed_backbone, const float *scales, float *params,
    size_t n, size_t f, size_t d_model, size_t n_layers, size_t rank,
    uint32_t task, size_t n_out, size_t epochs, size_t batch_size,
    float lr, float weight_decay, uint32_t backbone_seed, uint32_t train_seed);
void mle_dl_vera_predict(
    const float *x, const uint8_t *packed_backbone, const float *scales,
    const float *params, float *out,
    size_t n, size_t f, size_t d_model, size_t n_layers, size_t rank,
    uint32_t task, size_t n_out, uint32_t backbone_seed);

#ifdef __cplusplus
}
#endif

#endif /* MLE_DL_H */
