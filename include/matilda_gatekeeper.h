#ifndef MATILDA_GATEKEEPER_H
#define MATILDA_GATEKEEPER_H

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
} matilda_gatekeeper_t;

static inline unsigned int matilda_fnv1a_32(const char *str) {
    unsigned int hash = 0x811c9dc5;
    while (*str) {
        hash ^= (unsigned char)(*str++);
        hash *= 0x01000193;
    }
    return hash;
}

static inline float matilda_predict_prob(const matilda_gatekeeper_t *gk, const float x[520]) {
    float z = gk->bias;
    for (int i = 0; i < gk->dim && i < 520; i++) {
        z += gk->weights[i] * x[i];
    }
    if (z > 30.0f) z = 30.0f;
    if (z < -30.0f) z = -30.0f;
    return 1.0f / (1.0f + expf(-z));
}

static inline int matilda_decide(const matilda_gatekeeper_t *gk, const float x[520]) {
    float p = matilda_predict_prob(gk, x);
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

#ifdef __cplusplus
}
#endif

#endif /* MATILDA_GATEKEEPER_H */
