/// Returns the subset of `words` that `lang` ("de" / "en") does not accept.
#[tauri::command]
pub async fn spell_check(lang: String, words: Vec<String>) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || crate::spell::misspelled(&lang, &words))
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn spell_suggest(lang: String, word: String) -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(move || crate::spell::suggestions(&lang, &word))
        .await
        .map_err(|e| e.to_string())
}
