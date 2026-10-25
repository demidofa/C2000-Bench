//go:build !windows

package main

import "fmt"

func msgBox(text string) { fmt.Println("MSG:", text) }
