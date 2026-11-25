#ifndef VERSIEVE_H
#define VERSIEVE_H

#include <math.h>
#include <string.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct {
    int dim;
    float weights[520];
    float bias;
    float tau_keep;
    float tau_drop;
    int has_calibration;
} versieve_gatekeeper_t;

static inline unsigned int versieve_fnv1a_32(const char *str) {
    unsigned int hash = 0x811c9dc5;
    while (*str) {
        hash ^= (unsigned char)(*str++);
        hash *= 0x01000193;
    }
    return hash;
}

static inline float versieve_predict_prob(const versieve_gatekeeper_t *gk, const float x[520]) {
    float z = gk->bias;
    for (int i = 0; i < gk->dim && i < 520; i++) {
        z += gk->weights[i] * x[i];
    }
    if (z > 30.0f) z = 30.0f;
    if (z < -30.0f) z = -30.0f;
    return 1.0f / (1.0f + expf(-z));
}

static inline int versieve_decide(const versieve_gatekeeper_t *gk, const float x[520]) {
    float p = versieve_predict_prob(gk, x);
    if (!gk->has_calibration) {
        return p >= 0.5f ? 1 : 0;
    }
    if (p >= gk->tau_keep) {
        return 1; // KEEP_SAFE
    } else if (p <= gk->tau_drop) {
        return 0; // DROP_OR_QUARANTINE
    } else {
        return 2; // ABSTAIN_HUMAN_REVIEW
    }
}

/* Backward compatibility type and function aliases */
typedef versieve_gatekeeper_t rtio_gatekeeper_t;
typedef versieve_gatekeeper_t matilda_gatekeeper_t;

static inline unsigned int rtio_fnv1a_32(const char *str) { return versieve_fnv1a_32(str); }
static inline float rtio_predict_prob(const rtio_gatekeeper_t *gk, const float x[520]) { return versieve_predict_prob(gk, x); }
static inline int rtio_decide(const rtio_gatekeeper_t *gk, const float x[520]) { return versieve_decide(gk, x); }

static inline unsigned int matilda_fnv1a_32(const char *str) { return versieve_fnv1a_32(str); }
static inline float matilda_predict_prob(const matilda_gatekeeper_t *gk, const float x[520]) { return versieve_predict_prob(gk, x); }
static inline int matilda_decide(const matilda_gatekeeper_t *gk, const float x[520]) { return versieve_decide(gk, x); }

#ifdef __cplusplus
}
#endif

#endif /* VERSIEVE_H */
