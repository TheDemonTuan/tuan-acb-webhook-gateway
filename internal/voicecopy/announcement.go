package voicecopy

import (
	"fmt"
	"regexp"
	"strings"
	"unicode"
)

var urlPattern = regexp.MustCompile(`https?://\S+`)

// SanitizeDescription cleanses transaction description for TTS synthesis:
// strips URLs, control characters, special characters, and limits length to maxLength runes.
func SanitizeDescription(desc string, maxLength int) string {
	if desc == "" {
		return ""
	}
	if maxLength <= 0 {
		maxLength = 80
	}

	// Remove URLs
	s := urlPattern.ReplaceAllString(desc, " ")

	// Filter characters: letters, numbers, spaces, and simple punctuation (,. -)
	var b strings.Builder
	for _, r := range s {
		if unicode.IsLetter(r) || unicode.IsDigit(r) || unicode.IsSpace(r) || r == ',' || r == '.' || r == '-' {
			b.WriteRune(r)
		} else {
			b.WriteRune(' ')
		}
	}

	// Collapse multiple spaces
	words := strings.Fields(b.String())
	cleaned := strings.Join(words, " ")

	runes := []rune(cleaned)
	if len(runes) > maxLength {
		runes = runes[:maxLength]
		cleaned = strings.TrimSpace(string(runes))
	}

	return cleaned
}

// BuildCreditAnnouncement creates a natural Vietnamese announcement phrase for an incoming transaction.
func BuildCreditAnnouncement(amount int64, description string, includeDescription bool) string {
	amountWords := SpeakVND(amount)
	phrase := "Bạn vừa nhận được " + amountWords + "."

	if includeDescription && strings.TrimSpace(description) != "" {
		sanitized := SanitizeDescription(description, 80)
		if sanitized != "" {
			phrase += " Nội dung: " + sanitized + "."
		}
	}

	return phrase
}

// BuildBurstAnnouncement creates an aggregate announcement phrase for multiple transactions.
func BuildBurstAnnouncement(count int, totalAmount int64) string {
	totalWords := SpeakVND(totalAmount)
	return fmt.Sprintf("Bạn vừa nhận được %d giao dịch mới, tổng cộng %s.", count, totalWords)
}
