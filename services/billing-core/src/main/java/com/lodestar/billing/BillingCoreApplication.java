package com.lodestar.billing;

import java.time.Clock;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.Bean;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Entry point of the Lodestar billing-core service (port 4100).
 *
 * <p>Scheduling is enabled for the maintenance jobs declared in the service layer (idempotency
 * tombstone purge). All time-sensitive components receive the single UTC {@link Clock} bean
 * defined here, which keeps billing arithmetic deterministic and testable instead of scattering
 * {@code Instant.now()} calls through the codebase.
 */
@SpringBootApplication
@EnableScheduling
public class BillingCoreApplication {

    public static void main(String[] args) {
        SpringApplication.run(BillingCoreApplication.class, args);
    }

    /**
     * @return the system UTC clock injected into every time-sensitive service
     */
    @Bean
    public Clock clock() {
        return Clock.systemUTC();
    }
}
