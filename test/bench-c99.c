#include <stdio.h>
#include <stdlib.h>
#include <time.h>
#ifdef _WIN32
#include <windows.h>
#include <psapi.h>
#endif
#include "verisieve.h"

int main(int argc, char *argv[]) {
    int n_rows = 1207;
    int passes = 200;
    int dim = 520;
    if (argc > 1) n_rows = atoi(argv[1]);
    if (argc > 2) passes = atoi(argv[2]);

    verisieve_gatekeeper_t gk;
    gk.dim = dim;
    gk.bias = 0.05f;
    for (int j = 0; j < dim; j++) {
        gk.weights[j] = 0.002f * ((j % 11) - 5);
    }
    gk.has_calibration = 1;
    gk.tau_keep = 0.72f;
    gk.tau_drop = 0.28f;

    float *x = (float *)malloc(n_rows * dim * sizeof(float));
    if (!x) return 1;

    for (int i = 0; i < n_rows; i++) {
        for (int j = 0; j < dim; j++) {
            x[i * dim + j] = 0.01f * ((i + j) % 17);
        }
    }

    if (passes > 1) {
        for (int i = 0; i < n_rows; i++) {
            verisieve_decide(&gk, &x[i * dim]);
        }
    }

    clock_t t0 = clock();
    int safe_count = 0;
    float sum_p = 0.0f;
    for (int p = 0; p < passes; p++) {
        for (int i = 0; i < n_rows; i++) {
            float prob = verisieve_predict_prob(&gk, &x[i * dim]);
            if (prob >= gk.tau_keep) safe_count++;
            sum_p += prob;
        }
    }
    clock_t t1 = clock();
    double total_ms = ((double)(t1 - t0) * 1000.0) / CLOCKS_PER_SEC;
    double per_run_ms = total_ms / passes;

    double rss_mb = 0.0;
#ifdef _WIN32
    PROCESS_MEMORY_COUNTERS pmc;
    if (GetProcessMemoryInfo(GetCurrentProcess(), &pmc, sizeof(pmc))) {
        rss_mb = (double)pmc.PeakWorkingSetSize / (1024.0 * 1024.0);
    }
#endif

    printf("{\"n_rows\":%d,\"passes\":%d,\"per_run_ms\":%.4f,\"peak_rss_mb\":%.2f,\"sample_p\":%.6f,\"safe_ratio\":%.4f}\n",
           n_rows, passes, per_run_ms, rss_mb, sum_p / (n_rows * passes), (double)safe_count / (n_rows * passes));

    free(x);
    return 0;
}
