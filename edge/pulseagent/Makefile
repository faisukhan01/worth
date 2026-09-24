CC ?= cc
CFLAGS ?= -O2 -Wall -Wextra -std=c99 -D_POSIX_C_SOURCE=200809L
LDFLAGS ?=

.PHONY: all run clean

all: pulseagent

pulseagent: src/main.c
	$(CC) $(CFLAGS) -o $@ src/main.c $(LDFLAGS)

run: pulseagent
	./pulseagent

clean:
	rm -f pulseagent
