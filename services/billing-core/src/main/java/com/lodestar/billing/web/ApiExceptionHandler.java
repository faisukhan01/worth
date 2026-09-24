package com.lodestar.billing.web;

import java.time.Instant;
import java.util.List;
import java.util.NoSuchElementException;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ProblemDetail;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.MissingServletRequestParameterException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.HandlerMethodValidationException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;
import org.springframework.web.server.ResponseStatusException;

/**
 * Maps service-layer and framework exceptions onto RFC 7807 {@code application/problem+json}
 * responses.
 *
 * <p>Every problem document carries a {@code timestamp} property; validation failures
 * additionally carry an {@code errors} array of {@code {field, message}} entries. Business
 * rules surface as domain exceptions ({@code IllegalArgumentException} for bad input,
 * {@code IllegalStateException} for lifecycle violations, {@code NoSuchElementException} for
 * missing resources) so controllers stay free of status-code plumbing.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);
    private static final String TIMESTAMP_PROPERTY = "timestamp";
    private static final String ERRORS_PROPERTY = "errors";

    @ExceptionHandler(NoSuchElementException.class)
    public ProblemDetail handleNotFound(NoSuchElementException ex) {
        return problem(HttpStatus.NOT_FOUND, "Resource not found", ex.getMessage());
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ProblemDetail handleBadRequest(IllegalArgumentException ex) {
        return problem(HttpStatus.BAD_REQUEST, "Invalid request", ex.getMessage());
    }

    @ExceptionHandler(IllegalStateException.class)
    public ProblemDetail handleConflict(IllegalStateException ex) {
        return problem(HttpStatus.CONFLICT, "Operation not allowed", ex.getMessage());
    }

    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ProblemDetail handleInvalidBody(MethodArgumentNotValidException ex) {
        ProblemDetail problem = problem(HttpStatus.BAD_REQUEST, "Validation failed",
                "The request body failed validation");
        List<FieldErrorView> errors = ex.getBindingResult().getFieldErrors().stream()
                .map(error -> new FieldErrorView(error.getField(), error.getDefaultMessage()))
                .toList();
        problem.setProperty(ERRORS_PROPERTY, errors);
        return problem;
    }

    @ExceptionHandler(HandlerMethodValidationException.class)
    public ProblemDetail handleInvalidParameters(HandlerMethodValidationException ex) {
        return problem(HttpStatus.BAD_REQUEST, "Validation failed",
                "One or more request parameters failed validation");
    }

    @ExceptionHandler({MissingServletRequestParameterException.class, MethodArgumentTypeMismatchException.class})
    public ProblemDetail handleMalformedParameters(Exception ex) {
        return problem(HttpStatus.BAD_REQUEST, "Malformed request parameters", ex.getMessage());
    }

    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ProblemDetail handleUnreadableBody(HttpMessageNotReadableException ex) {
        return problem(HttpStatus.BAD_REQUEST, "Malformed request body",
                "The request body could not be parsed as valid JSON for this endpoint");
    }

    @ExceptionHandler(ResponseStatusException.class)
    public ProblemDetail handleResponseStatus(ResponseStatusException ex) {
        String detail = ex.getReason() == null ? "Request failed" : ex.getReason();
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(ex.getStatusCode(), detail);
        problem.setTitle(ex.getStatusCode().toString());
        problem.setProperty(TIMESTAMP_PROPERTY, Instant.now());
        return problem;
    }

    @ExceptionHandler(Exception.class)
    public ProblemDetail handleUnexpected(Exception ex) {
        log.error("Unhandled exception while serving a billing request", ex);
        // The detail is deliberately generic: internals must not leak to callers.
        return problem(HttpStatus.INTERNAL_SERVER_ERROR, "Unexpected error",
                "An unexpected error occurred; see server logs for details");
    }

    private ProblemDetail problem(HttpStatus status, String title, String detail) {
        ProblemDetail problem = ProblemDetail.forStatusAndDetail(status, detail == null ? title : detail);
        problem.setTitle(title);
        problem.setProperty(TIMESTAMP_PROPERTY, Instant.now());
        return problem;
    }

    private record FieldErrorView(String field, String message) {
    }
}
