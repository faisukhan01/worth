package com.lodestar.billing.dto;

import java.math.BigDecimal;

/**
 * API projection of a plan in the commercial catalog.
 *
 * @param name                   plan name ({@code STARTER}, {@code PRO}, {@code ENTERPRISE})
 * @param monthlyBasePrice       flat monthly base price in USD
 * @param includedEventsPerMonth events per month included in the base price
 * @param includedHosts          monitored hosts included in the base price
 * @param perMillionOverage      USD price per one million events above the allowance
 */
public record PlanView(String name, BigDecimal monthlyBasePrice, long includedEventsPerMonth,
                       int includedHosts, BigDecimal perMillionOverage) {
}
