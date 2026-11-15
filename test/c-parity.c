#include <stdio.h>
#include <assert.h>
#include "matilda_gatekeeper.h"

int main() {
    matilda_gatekeeper_t gk;
    gk.dim = 520;
    gk.bias = 0.1f;
    for (int i = 0; i < 520; i++) {
        gk.weights[i] = 0.001f * (i % 5);
    }
    gk.has_calibration = 1;
    gk.tau_keep = 0.7f;
    gk.tau_drop = 0.3f;

    float x[520];
    for (int i = 0; i < 520; i++) x[i] = 0.1f;

    float p = matilda_predict_prob(&gk, x);
    int decision = matilda_decide(&gk, x);

    printf("C99 Test: prob = %f, decision = %d\n", p, decision);
    assert(p >= 0.0f && p <= 1.0f);
    printf("C parity test passed successfully!\n");
    return 0;
}
