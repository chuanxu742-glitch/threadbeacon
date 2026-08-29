package com.threadbeacon.control.system;

import io.micrometer.core.instrument.MeterRegistry;
import io.micrometer.core.instrument.Timer;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.MDC;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

@Component
public class RequestCorrelationFilter extends OncePerRequestFilter {
    private static final String HEADER = "X-Request-Id";
    private final MeterRegistry metrics;

    public RequestCorrelationFilter(MeterRegistry metrics) {
        this.metrics = metrics;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        var supplied = request.getHeader(HEADER);
        var requestId = supplied != null && supplied.matches("[A-Za-z0-9._:-]{8,128}")
                ? supplied
                : UUID.randomUUID().toString();
        var started = System.nanoTime();
        response.setHeader(HEADER, requestId);
        try (var ignored = MDC.putCloseable("requestId", requestId)) {
            chain.doFilter(request, response);
        } finally {
            Timer.builder("threadbeacon.http.server.duration")
                    .tag("method", request.getMethod())
                    .tag("status", Integer.toString(response.getStatus()))
                    .register(metrics)
                    .record(System.nanoTime() - started, TimeUnit.NANOSECONDS);
        }
    }
}
