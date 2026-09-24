package com.lodestar.billing.config;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.SerializationFeature;

import org.springframework.boot.autoconfigure.jackson.Jackson2ObjectMapperBuilderCustomizer;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Jackson customisations for the REST layer and the persisted invoice JSON documents.
 *
 * <p>The JSON contract is pinned here in code rather than only in {@code application.yml} so it
 * survives deployment-time configuration overrides:
 * <ul>
 *   <li>Dates serialize as ISO-8601 strings, never as numeric timestamps - the API contract and
 *       the stored invoice documents depend on the textual form.</li>
 *   <li>Unknown properties are ignored on deserialization so older producers and stored
 *       documents survive the addition of new fields without a coordinated deployment - a
 *       deliberate trade-off in favour of forward compatibility over strictness for an internal
 *       billing contract.</li>
 * </ul>
 * Null-field omission ({@code default-property-inclusion: non_null}) remains configured in
 * {@code application.yml} alongside the datasource and port settings.
 */
@Configuration
public class JacksonConfig {

    @Bean
    public Jackson2ObjectMapperBuilderCustomizer lodestarJacksonCustomizer() {
        return builder -> builder.featuresToDisable(
                SerializationFeature.WRITE_DATES_AS_TIMESTAMPS,
                DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
    }
}
