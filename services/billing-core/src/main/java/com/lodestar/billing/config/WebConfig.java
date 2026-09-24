package com.lodestar.billing.config;

import java.util.Arrays;
import java.util.List;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web MVC configuration.
 *
 * <p>CORS is a development convenience so the Next.js dashboard (default origin
 * {@code http://localhost:3000}, override with {@code lodestar.cors.allowed-origins}) can call
 * this service directly while designers and demos iterate locally. In production the platform
 * gateway fronts billing-core and cross-origin traffic never reaches this application, so the
 * policy stays permissive-but-configured rather than growing a full authentication filter.
 */
@Configuration
public class WebConfig implements WebMvcConfigurer {

    private final List<String> allowedOrigins;

    public WebConfig(@Value("${lodestar.cors.allowed-origins:http://localhost:3000}") String allowedOrigins) {
        this.allowedOrigins = Arrays.stream(allowedOrigins.split(","))
                .map(String::trim)
                .filter(origin -> !origin.isEmpty())
                .toList();
    }

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/v1/**")
                .allowedOrigins(allowedOrigins.toArray(String[]::new))
                .allowedMethods("GET", "POST", "PUT", "OPTIONS")
                .allowedHeaders("*")
                .maxAge(3600);
    }
}
