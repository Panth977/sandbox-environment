package daemon

import (
	"encoding/json"
	"fmt"
	"regexp"
)

// Validate checks a value against the JSON Schema subset the schema builders emit.
func Validate(schema json.RawMessage, value any) error {
	if len(schema) == 0 {
		return nil
	}
	var s map[string]any
	if err := json.Unmarshal(schema, &s); err != nil {
		return fmt.Errorf("bad schema")
	}
	return check("input", s, value)
}

func num(v any) (float64, bool) { f, ok := v.(float64); return f, ok }

func check(at string, s map[string]any, v any) error {
	if list, ok := s["anyOf"].([]any); ok {
		for _, o := range list {
			if m, ok := o.(map[string]any); ok && check(at, m, v) == nil {
				return nil
			}
		}
		return fmt.Errorf("%s: matches no allowed type", at)
	}
	if c, ok := s["const"]; ok && c != v {
		return fmt.Errorf("%s: must be %v", at, c)
	}
	if list, ok := s["enum"].([]any); ok {
		for _, e := range list {
			if e == v {
				return nil
			}
		}
		return fmt.Errorf("%s: not an allowed value", at)
	}
	t, _ := s["type"].(string)
	switch t {
	case "":
		return nil
	case "null":
		if v != nil {
			return fmt.Errorf("%s: must be null", at)
		}
	case "boolean":
		if _, ok := v.(bool); !ok {
			return fmt.Errorf("%s: must be a boolean", at)
		}
	case "string":
		str, ok := v.(string)
		if !ok {
			return fmt.Errorf("%s: must be a string", at)
		}
		n := float64(len([]rune(str)))
		if m, ok := num(s["minLength"]); ok && n < m {
			return fmt.Errorf("%s: too short", at)
		}
		if m, ok := num(s["maxLength"]); ok && n > m {
			return fmt.Errorf("%s: too long", at)
		}
		if p, ok := s["pattern"].(string); ok {
			re, err := regexp.Compile(p)
			if err != nil || !re.MatchString(str) {
				return fmt.Errorf("%s: wrong format", at)
			}
		}
	case "number", "integer":
		f, ok := num(v)
		if !ok {
			return fmt.Errorf("%s: must be a number", at)
		}
		if t == "integer" && f != float64(int64(f)) {
			return fmt.Errorf("%s: must be an integer", at)
		}
		if m, ok := num(s["minimum"]); ok && f < m {
			return fmt.Errorf("%s: too small", at)
		}
		if m, ok := num(s["maximum"]); ok && f > m {
			return fmt.Errorf("%s: too large", at)
		}
	case "array":
		a, ok := v.([]any)
		if !ok {
			return fmt.Errorf("%s: must be an array", at)
		}
		if m, ok := num(s["minItems"]); ok && float64(len(a)) < m {
			return fmt.Errorf("%s: too few items", at)
		}
		if m, ok := num(s["maxItems"]); ok && float64(len(a)) > m {
			return fmt.Errorf("%s: too many items", at)
		}
		item, _ := s["items"].(map[string]any)
		for i, e := range a {
			if item != nil {
				if err := check(fmt.Sprintf("%s[%d]", at, i), item, e); err != nil {
					return err
				}
			}
		}
	case "object":
		o, ok := v.(map[string]any)
		if !ok {
			return fmt.Errorf("%s: must be an object", at)
		}
		props, _ := s["properties"].(map[string]any)
		req, _ := s["required"].([]any)
		for _, r := range req {
			if _, ok := o[r.(string)]; !ok {
				return fmt.Errorf("%s.%v: missing", at, r)
			}
		}
		extra, _ := s["additionalProperties"].(map[string]any)
		for k, e := range o {
			if p, ok := props[k].(map[string]any); ok {
				if err := check(at+"."+k, p, e); err != nil {
					return err
				}
			} else if extra != nil {
				if err := check(at+"."+k, extra, e); err != nil {
					return err
				}
			} else if props != nil {
				return fmt.Errorf("%s.%s: unknown field", at, k)
			}
		}
	}
	return nil
}
