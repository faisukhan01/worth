.PHONY: run build vet lint clean

run: ## Run the gateway locally on :3100
	go run ./cmd/gateway

build: ## Build the gateway binary
	CGO_ENABLED=0 go build -trimpath -o bin/gateway ./cmd/gateway

vet: ## Static analysis
	go vet ./...

clean: ## Remove build artifacts
	rm -rf bin
