use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;

const SEARCH_NGRAM_MAX: usize = 3;

fn is_cjk_search_char(char_value: char) -> bool {
    matches!(
      char_value as u32,
      0x3400..=0x4dbf
        | 0x4e00..=0x9fff
        | 0xf900..=0xfaff
        | 0x3040..=0x309f
        | 0x30a0..=0x30ff
        | 0xac00..=0xd7af
    )
}

fn is_search_word_char(char_value: char) -> bool {
    char_value.is_alphanumeric()
}

fn normalized_search_text(value: Option<&str>) -> String {
    value
        .unwrap_or("")
        .nfkc()
        .flat_map(|char_value| char_value.to_lowercase())
        .collect::<String>()
}

fn search_runs(value: Option<&str>) -> Vec<String> {
    let text = normalized_search_text(value);
    let mut runs = Vec::new();
    let mut current = String::new();
    let mut current_type: Option<&str> = None;

    for char_value in text.chars() {
        let char_type = if is_cjk_search_char(char_value) {
            Some("cjk")
        } else if is_search_word_char(char_value) {
            Some("word")
        } else {
            None
        };

        if char_type.is_none() {
            if !current.is_empty() {
                runs.push(current.clone());
            }
            current.clear();
            current_type = None;
            continue;
        }

        if current_type.is_some() && current_type != char_type {
            runs.push(current.clone());
            current.clear();
        }

        current.push(char_value);
        current_type = char_type;
    }

    if !current.is_empty() {
        runs.push(current);
    }

    runs
}

fn add_ngrams(tokens: &mut HashSet<String>, run: &str) {
    let chars = run.chars().collect::<Vec<char>>();
    let max_size = SEARCH_NGRAM_MAX.min(chars.len());

    for size in 1..=max_size {
        for start in 0..=(chars.len() - size) {
            tokens.insert(chars[start..start + size].iter().collect());
        }
    }
}

fn compact_search_value(value: Option<&str>) -> String {
    normalized_search_text(value)
        .chars()
        .filter(|char_value| is_cjk_search_char(*char_value) || is_search_word_char(*char_value))
        .collect()
}

pub(crate) fn build_video_search_text(title: Option<&str>, url: Option<&str>) -> String {
    let mut tokens = HashSet::new();

    for value in [title, url] {
        for run in search_runs(value) {
            add_ngrams(&mut tokens, &run);
        }

        let compact = compact_search_value(value);
        if !compact.is_empty() {
            add_ngrams(&mut tokens, &compact);
        }
    }

    let mut keys = tokens.into_iter().collect::<Vec<String>>();
    keys.sort();
    keys.join(" ")
}

fn search_query_tokens_for_run(run: &str) -> Vec<String> {
    let chars = run.chars().collect::<Vec<char>>();
    if chars.len() <= SEARCH_NGRAM_MAX {
        return vec![run.to_string()];
    }

    let mut tokens = Vec::new();
    for start in 0..=(chars.len() - SEARCH_NGRAM_MAX) {
        tokens.push(chars[start..start + SEARCH_NGRAM_MAX].iter().collect());
    }

    tokens
}

fn search_text_has(search_text: &str, token: &str) -> bool {
    search_text.split_whitespace().any(|entry| entry == token)
}

fn matches_search_term(search_text: &str, term: &str) -> bool {
    let runs = search_runs(Some(term));
    if runs.is_empty() {
        return true;
    }

    runs.iter().all(|run| {
        search_query_tokens_for_run(run)
            .iter()
            .all(|token| search_text_has(search_text, token))
    })
}

pub(crate) fn matches_search(search_text: &str, search: Option<&str>, search_mode: &str) -> bool {
    let Some(search) = search else {
        return true;
    };
    let search = search.trim();
    if search.is_empty() {
        return true;
    }

    if search_mode == "phrase" {
        let compact = compact_search_value(Some(search));
        if compact.is_empty() {
            return true;
        }

        return search_query_tokens_for_run(&compact)
            .iter()
            .all(|token| search_text_has(search_text, token));
    }

    let terms = search
        .split_whitespace()
        .filter(|term| !term.is_empty())
        .collect::<Vec<&str>>();
    if terms.is_empty() {
        return true;
    }

    if search_mode == "all" {
        terms
            .iter()
            .all(|term| matches_search_term(search_text, term))
    } else {
        terms
            .iter()
            .any(|term| matches_search_term(search_text, term))
    }
}
