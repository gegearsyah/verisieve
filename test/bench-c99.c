#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#include "verisieve.h"

int main(int argc, char *argv[]) {
    // Reads gatekeeper weights and feature vectors from a binary file or stdin
    // If run without arguments, runs a deterministic benchmark of 1,207 rows x 520 dim
    int n_rows = 1207;
    int dim = 520;
    if (argc > 1) {
        n_rows = atoi(argv[1]);
    }

    verisieve_gatekeeper_t gk;
    gk.dim = dim;
    gk.bias = 0.05f;
    for (int j = 0; j < dim; j++) {
        gk.weights[j] = 0.002f * ((j % 11) - 5);
    }
    gk.has_calibration = 1;
    gk.tau_keep = 0.72f;
    gk.tau_drop = 0.28f;

    // Allocate 1207 rows of 520 floats
    float *x = (float *)malloc(n_rows * dim * sizeof(float));
    if (!x) return 1;

    // Seeded synthetic/real features for timing
    for (int i = 0; i < n_rows; i++) {
        for (int j = 0; j < dim; j++) {
            x[i * dim + j] = 0.01f * ((i + j) % 17);
        }
    }

    // Warmup
    for (int i = 0; i < n_rows; i++) {
        verisieve_decide(&gk, &x[i * dim]);
    }

    // Benchmark 3 passes
    clock_t t0 = clock();
    int passes = 10;
    int safe_count = 0;
    float sum_p = 0.0f;
    for (int p = 0; p < passes; p++) {
        for (int i = 0; i < n_rows; i++) {
            float prob = verisieve_predict_prob(&gk, &x[i * dim]);
            int dec = verisieve_decide(&gk, &x[i * dim]);
            if (dec == 1) safe_count++;
            sum_p += prob;
        }
    }
    clock_t t1 = clock();
    double total_ms = ((double)(t1 - t0) * 1000.0) / CLOCKS_PER_SEC;
    double per_run_ms = total_ms / passes;

    printf("{\"n_rows\":%d,\"passes\":%d,\"per_run_ms\":%.4f,\"sample_p\":%.6f,\"safe_ratio\":%.4f}\n",
           n_rows, passes, per_run_ms, sum_p / (n_rows * passes), (double)safe_count / (n_rows * passes));

    free(x);
    return 0;
}
