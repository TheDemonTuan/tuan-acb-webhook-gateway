package voicecopy

import (
	"fmt"
	"strings"
)

var digits = []string{"không", "một", "hai", "ba", "bốn", "năm", "sáu", "bảy", "tám", "chín"}

func readThreeDigits(n int, hasHigherGroup bool) []string {
	hundreds := n / 100
	tens := (n % 100) / 10
	units := n % 10
	var words []string

	if hundreds > 0 || hasHigherGroup {
		words = append(words, digits[hundreds], "trăm")
	}

	if tens > 1 {
		words = append(words, digits[tens], "mươi")
		switch units {
		case 1:
			words = append(words, "mốt")
		case 4:
			words = append(words, "tư")
		case 5:
			words = append(words, "lăm")
		default:
			if units > 0 {
				words = append(words, digits[units])
			}
		}
	} else if tens == 1 {
		words = append(words, "mười")
		if units == 5 {
			words = append(words, "lăm")
		} else if units > 0 {
			words = append(words, digits[units])
		}
	} else if tens == 0 {
		if units > 0 {
			if hundreds > 0 || hasHigherGroup {
				words = append(words, "linh", digits[units])
			} else {
				words = append(words, digits[units])
			}
		}
	}

	return words
}

// SpeakVND converts an int64 amount into natural spoken Vietnamese text followed by "đồng".
// Example: 500000 -> "năm trăm nghìn đồng"
// Example: 1250000 -> "một triệu hai trăm năm mươi nghìn đồng"
func SpeakVND(amount int64) string {
	if amount <= 0 {
		return "không đồng"
	}

	// Break amount into groups of 3 digits
	var groups []int
	val := amount
	for val > 0 {
		groups = append(groups, int(val%1000))
		val /= 1000
	}

	scaleUnits := []string{"", "nghìn", "triệu", "tỷ"}

	var resultParts []string
	for i := len(groups) - 1; i >= 0; i-- {
		groupVal := groups[i]
		if groupVal == 0 {
			continue
		}

		hasHigher := (i < len(groups)-1)
		groupWords := readThreeDigits(groupVal, hasHigher)
		if len(groupWords) == 0 {
			continue
		}

		scale := ""
		if i < len(scaleUnits) {
			scale = scaleUnits[i]
		} else {
			// For extremely large numbers (> 10^12)
			tyCount := i / 3
			rem := i % 3
			if rem > 0 && rem < len(scaleUnits) {
				scale = fmt.Sprintf("%s %s", scaleUnits[rem], strings.Repeat("tỷ ", tyCount))
			} else {
				scale = strings.TrimSpace(strings.Repeat("tỷ ", tyCount))
			}
		}

		part := strings.Join(groupWords, " ")
		if scale != "" {
			part = part + " " + scale
		}
		resultParts = append(resultParts, part)
	}

	if len(resultParts) == 0 {
		return "không đồng"
	}

	return strings.Join(resultParts, " ") + " đồng"
}
