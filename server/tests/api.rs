use std::path::PathBuf;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use obsidian_sync_server::{app, db, state::AppState};
use serde_json::{Value, json};
use tempfile::TempDir;
use tower::util::ServiceExt;

#[tokio::test]
async fn health_returns_ok() {
    let (_tmp_dir, app) = test_app().await;

    let response = app
        .oneshot(
            Request::builder()
                .uri("/health")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(read_json(response).await, json!({ "ok": true }));
}

#[tokio::test]
async fn rejects_protected_routes_without_bearer_token() {
    let (_tmp_dir, app) = test_app_with_token("secret-token").await;

    let response = app
        .oneshot(
            Request::builder()
                .uri("/changes?vault_id=vault-a&since=0")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(
        read_json(response).await,
        json!({
            "error": "unauthorized",
            "message": "valid bearer token is required"
        })
    );
}

#[tokio::test]
async fn accepts_any_configured_bearer_token() {
    let (_tmp_dir, app) = test_app_with_tokens(&["token-a", "token-b"]).await;

    let response = app
        .oneshot(
            Request::builder()
                .uri("/changes?vault_id=vault-a&since=0")
                .header("authorization", "Bearer token-b")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        json!({
            "changes": [],
            "latest_seq": 0
        })
    );
}

#[tokio::test]
async fn create_vault_then_list_vaults() {
    let (_tmp_dir, app) = test_app().await;

    let create_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/vaults")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "product_docs",
                        "e2ee_fingerprint": "fingerprint-123"
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(create_response.status(), StatusCode::OK);
    let created = read_json(create_response).await;
    assert_eq!(created["ok"], json!(true));
    assert_eq!(created["created"], json!(true));
    assert_eq!(created["vault"]["vault_id"], json!("product_docs"));
    assert_eq!(created["vault"]["device_count"], json!(0));
    assert_eq!(
        created["vault"]["e2ee_fingerprint"],
        json!("fingerprint-123")
    );

    let vaults_response = app
        .oneshot(
            Request::builder()
                .uri("/vaults")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(vaults_response.status(), StatusCode::OK);
    let listed = read_json(vaults_response).await;
    assert_eq!(listed["vaults"].as_array().unwrap().len(), 1);
    assert_eq!(listed["vaults"][0]["vault_id"], json!("product_docs"));
}

#[tokio::test]
async fn snapshot_returns_current_vault_state() {
    let (_tmp_dir, app) = test_app().await;

    upload_test_file(&app).await;

    let delete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/delete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-a",
                        "device_id": "device_a",
                        "path": "notes/test.md",
                        "base_version": 1
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(delete_response.status(), StatusCode::OK);

    let second_upload = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-a",
                        "device_id": "device_b",
                        "path": "notes/live.md",
                        "content_b64": "d29ybGQK",
                        "hash": "e258d248fda94c63753607f7c4494ee0fcbe92f1a76bfdac795c9d84101eb317",
                        "payload_hash": "e258d248fda94c63753607f7c4494ee0fcbe92f1a76bfdac795c9d84101eb317",
                        "content_format": "plain",
                        "base_version": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(second_upload.status(), StatusCode::OK);

    let snapshot_response = app
        .oneshot(
            Request::builder()
                .uri("/snapshot?vault_id=vault-a")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(snapshot_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(snapshot_response).await,
        json!({
            "latest_seq": 3,
            "files": [
                {
                    "path": "notes/live.md",
                    "hash": "e258d248fda94c63753607f7c4494ee0fcbe92f1a76bfdac795c9d84101eb317",
                    "version": 1,
                    "deleted": false,
                    "content_format": "plain"
                },
                {
                    "path": "notes/test.md",
                    "hash": "",
                    "version": 2,
                    "deleted": true,
                    "content_format": "plain"
                }
            ]
        })
    );
}

#[tokio::test]
async fn rename_moves_file_atomically_and_preserves_metadata() {
    let (_tmp_dir, app) = test_app().await;

    let first_upload = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-a",
                        "device_id": "device-a",
                        "path": "notes/test.md",
                        "content_b64": "ZW5jcnlwdGVk",
                        "hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
                        "payload_hash": "954d1bb83d80bb6f6e746b28f0de3ec4c4ed980cfe67ed23a9159cd464ff339a",
                        "content_format": "e2ee-envelope-v1",
                        "base_version": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first_upload.status(), StatusCode::OK);

    let rename_response = rename_file(
        &app,
        "vault-a",
        "device-a",
        "notes/test.md",
        "notes/renamed.md",
        1,
    )
    .await;
    assert_eq!(rename_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(rename_response).await,
        json!({ "ok": true, "version": 2 })
    );

    let old_file = get_file(&app, "vault-a", "notes/test.md").await;
    assert_eq!(
        read_json(old_file).await,
        json!({
            "path": "notes/test.md",
            "hash": "",
            "version": 2,
            "deleted": true,
            "content_b64": null,
            "content_format": "e2ee-envelope-v1"
        })
    );

    let new_file = get_file(&app, "vault-a", "notes/renamed.md").await;
    assert_eq!(
        read_json(new_file).await,
        json!({
            "path": "notes/renamed.md",
            "hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
            "version": 2,
            "deleted": false,
            "content_b64": "ZW5jcnlwdGVk",
            "content_format": "e2ee-envelope-v1"
        })
    );

    let changes = get_changes(&app, "vault-a", 0).await;
    assert_eq!(
        read_json(changes).await,
        json!({
            "changes": [
                {
                    "seq": 1,
                    "device_id": "device-a",
                    "path": "notes/test.md",
                    "version": 1,
                    "deleted": false
                },
                {
                    "seq": 2,
                    "device_id": "device-a",
                    "path": "notes/test.md",
                    "version": 2,
                    "deleted": true
                },
                {
                    "seq": 3,
                    "device_id": "device-a",
                    "path": "notes/renamed.md",
                    "version": 2,
                    "deleted": false
                }
            ],
            "latest_seq": 3
        })
    );
}

#[tokio::test]
async fn upload_auto_registers_vault_in_registry() {
    let (_tmp_dir, app) = test_app().await;

    upload_test_file(&app).await;

    let vaults_response = app
        .oneshot(
            Request::builder()
                .uri("/vaults")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(vaults_response.status(), StatusCode::OK);
    let listed = read_json(vaults_response).await;
    let vaults = listed["vaults"].as_array().unwrap();
    assert_eq!(vaults.len(), 1);
    assert_eq!(vaults[0]["vault_id"], json!("vault-a"));
    assert_eq!(vaults[0]["device_count"], json!(1));
    assert_eq!(vaults[0]["e2ee_fingerprint"], Value::Null);
    assert!(vaults[0]["created_at"].as_str().unwrap().contains('T'));
    assert!(vaults[0]["updated_at"].as_str().unwrap().contains('T'));
}

#[tokio::test]
async fn upload_file_then_fetch_file_and_changes() {
    let (_tmp_dir, app) = test_app().await;

    let upload_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-a",
                        "device_id": "device_a",
                        "path": "notes/test.md",
                        "content_b64": "aGVsbG8K",
                        "hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
                        "payload_hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
                        "content_format": "plain",
                        "base_version": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(upload_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(upload_response).await,
        json!({ "ok": true, "version": 1 })
    );

    let file_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/file?vault_id=vault-a&path=notes%2Ftest.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(file_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(file_response).await,
        json!({
            "path": "notes/test.md",
            "hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
            "version": 1,
            "deleted": false,
            "content_b64": "aGVsbG8K",
            "content_format": "plain"
        })
    );

    let changes_response = app
        .oneshot(
            Request::builder()
                .uri("/changes?vault_id=vault-a&since=0")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(changes_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(changes_response).await,
        json!({
            "changes": [
                {
                    "seq": 1,
                    "device_id": "device_a",
                    "path": "notes/test.md",
                    "version": 1,
                    "deleted": false
                }
            ],
            "latest_seq": 1
        })
    );
}

#[tokio::test]
async fn events_stream_sends_initial_latest_seq() {
    let (_tmp_dir, app) = test_app().await;

    upload_test_file(&app).await;

    let response = app
        .oneshot(
            Request::builder()
                .uri("/events?vault_id=vault-a&since=0")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get("content-type")
            .and_then(|value| value.to_str().ok()),
        Some("text/event-stream")
    );

    let mut body = response.into_body();
    let frame = body.frame().await.unwrap().unwrap();
    let bytes = frame.into_data().unwrap();
    let text = String::from_utf8(bytes.to_vec()).unwrap();
    assert!(text.contains("event: change"));
    assert!(text.contains("{\"latest_seq\":1}"));
}

#[tokio::test]
async fn stale_upload_returns_conflict() {
    let (_tmp_dir, app) = test_app().await;

    upload_test_file(&app).await;

    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-a",
                        "device_id": "device_a",
                        "path": "notes/test.md",
                        "content_b64": "d29ybGQK",
                        "hash": "e258d248fda94c63753607f7c4494ee0fcbe92f1a76bfdac795c9d84101eb317",
                        "payload_hash": "e258d248fda94c63753607f7c4494ee0fcbe92f1a76bfdac795c9d84101eb317",
                        "content_format": "plain",
                        "base_version": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        read_json(response).await,
        json!({
            "ok": false,
            "conflict": true,
            "server_version": 1
        })
    );
}

#[tokio::test]
async fn upload_e2ee_payload_then_fetch_file_metadata() {
    let (_tmp_dir, app) = test_app().await;

    let upload_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-a",
                        "device_id": "device_a",
                        "path": "notes/secret.md",
                        "content_b64": "ZW5jcnlwdGVk",
                        "hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
                        "payload_hash": "954d1bb83d80bb6f6e746b28f0de3ec4c4ed980cfe67ed23a9159cd464ff339a",
                        "content_format": "e2ee-envelope-v1",
                        "base_version": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(upload_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(upload_response).await,
        json!({ "ok": true, "version": 1 })
    );

    let file_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/file?vault_id=vault-a&path=notes%2Fsecret.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(file_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(file_response).await,
        json!({
            "path": "notes/secret.md",
            "hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
            "version": 1,
            "deleted": false,
            "content_b64": "ZW5jcnlwdGVk",
            "content_format": "e2ee-envelope-v1"
        })
    );
}

#[tokio::test]
async fn delete_creates_tombstone_and_change_event() {
    let (_tmp_dir, app) = test_app().await;

    upload_test_file(&app).await;

    let delete_response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/delete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-a",
                        "device_id": "device_a",
                        "path": "notes/test.md",
                        "base_version": 1
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(delete_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(delete_response).await,
        json!({ "ok": true, "version": 2 })
    );

    let file_response = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/file?vault_id=vault-a&path=notes%2Ftest.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(file_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(file_response).await,
        json!({
            "path": "notes/test.md",
            "hash": "",
            "version": 2,
            "deleted": true,
            "content_b64": null,
            "content_format": "plain"
        })
    );

    let changes_response = app
        .oneshot(
            Request::builder()
                .uri("/changes?vault_id=vault-a&since=0")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(changes_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(changes_response).await,
        json!({
            "changes": [
                {
                    "seq": 1,
                    "device_id": "device_a",
                    "path": "notes/test.md",
                    "version": 1,
                    "deleted": false
                },
                {
                    "seq": 2,
                    "device_id": "device_a",
                    "path": "notes/test.md",
                    "version": 2,
                    "deleted": true
                }
            ],
            "latest_seq": 2
        })
    );
}

#[tokio::test]
async fn history_lists_versions_and_restore_recreates_old_content() {
    let (_tmp_dir, app) = test_app().await;

    let first_upload = upload_file(
        &app,
        "vault-a",
        "device-a",
        "notes/history.md",
        "Zmlyc3QK",
        "b640e840b19d378660b32fb51ae18d67dccb4a8596a29e7bd72c1b2ae5928f41",
        0,
    )
    .await;
    assert_eq!(first_upload.status(), StatusCode::OK);
    assert_eq!(
        read_json(first_upload).await,
        json!({ "ok": true, "version": 1 })
    );

    let second_upload = upload_file(
        &app,
        "vault-a",
        "device-a",
        "notes/history.md",
        "c2Vjb25kCg==",
        "480c2336b410f1ad5f8bf1b28944490255804b65350c527787e74ebdd511e3a4",
        1,
    )
    .await;
    assert_eq!(second_upload.status(), StatusCode::OK);
    assert_eq!(
        read_json(second_upload).await,
        json!({ "ok": true, "version": 2 })
    );

    let history_response = get_history(&app, "vault-a", "notes/history.md").await;
    assert_eq!(history_response.status(), StatusCode::OK);
    let history_json = read_json(history_response).await;
    assert_eq!(history_json["path"], json!("notes/history.md"));
    let versions = history_json["versions"].as_array().unwrap();
    assert_eq!(versions.len(), 2);
    assert_eq!(versions[0]["version"], json!(2));
    assert_eq!(
        versions[0]["hash"],
        json!("480c2336b410f1ad5f8bf1b28944490255804b65350c527787e74ebdd511e3a4")
    );
    assert_eq!(versions[0]["content_format"], json!("plain"));
    assert_eq!(versions[0]["deleted"], json!(false));
    assert!(versions[0]["created_at"].as_str().unwrap().contains('T'));
    assert_eq!(versions[1]["version"], json!(1));
    assert_eq!(
        versions[1]["hash"],
        json!("b640e840b19d378660b32fb51ae18d67dccb4a8596a29e7bd72c1b2ae5928f41")
    );
    assert_eq!(versions[1]["content_format"], json!("plain"));
    assert_eq!(versions[1]["deleted"], json!(false));
    assert!(versions[1]["created_at"].as_str().unwrap().contains('T'));

    let restore_response =
        restore_file(&app, "vault-a", "device-a", "notes/history.md", 1, 2).await;
    assert_eq!(restore_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(restore_response).await,
        json!({ "ok": true, "version": 3 })
    );

    let file_response = get_file(&app, "vault-a", "notes/history.md").await;
    assert_eq!(file_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(file_response).await,
        json!({
            "path": "notes/history.md",
            "hash": "b640e840b19d378660b32fb51ae18d67dccb4a8596a29e7bd72c1b2ae5928f41",
            "version": 3,
            "deleted": false,
            "content_b64": "Zmlyc3QK",
            "content_format": "plain"
        })
    );
}

async fn test_app() -> (TempDir, axum::Router) {
    test_app_with_token("").await
}

async fn test_app_with_token(token: &str) -> (TempDir, axum::Router) {
    if token.is_empty() {
        test_app_with_tokens(&[]).await
    } else {
        let tokens = [token];
        test_app_with_tokens(&tokens).await
    }
}

async fn test_app_with_tokens(tokens: &[&str]) -> (TempDir, axum::Router) {
    let temp_dir = TempDir::new().unwrap();
    let database_url = sqlite_url(temp_dir.path().join("sync.db"));
    let storage_root = temp_dir.path().join("files");

    let pool = db::connect(&database_url).await.unwrap();
    db::migrate(&pool).await.unwrap();

    let auth_tokens = tokens.iter().map(|token| token.to_string()).collect();
    let state = AppState::new(pool, storage_root, auth_tokens);
    (temp_dir, app::build_router(state))
}

async fn upload_test_file(app: &axum::Router) {
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-a",
                        "device_id": "device_a",
                        "path": "notes/test.md",
                        "content_b64": "aGVsbG8K",
                        "hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
                        "payload_hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
                        "content_format": "plain",
                        "base_version": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
}

#[tokio::test]
async fn isolates_same_path_across_vaults() {
    let (_tmp_dir, app) = test_app().await;

    let first = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-a",
                        "device_id": "device_a",
                        "path": "notes/shared.md",
                        "content_b64": "Zmlyc3QK",
                        "hash": "b640e840b19d378660b32fb51ae18d67dccb4a8596a29e7bd72c1b2ae5928f41",
                        "payload_hash": "b640e840b19d378660b32fb51ae18d67dccb4a8596a29e7bd72c1b2ae5928f41",
                        "content_format": "plain",
                        "base_version": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(first.status(), StatusCode::OK);

    let second = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": "vault-b",
                        "device_id": "device_b",
                        "path": "notes/shared.md",
                        "content_b64": "c2Vjb25kCg==",
                        "hash": "480c2336b410f1ad5f8bf1b28944490255804b65350c527787e74ebdd511e3a4",
                        "payload_hash": "480c2336b410f1ad5f8bf1b28944490255804b65350c527787e74ebdd511e3a4",
                        "content_format": "plain",
                        "base_version": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(second.status(), StatusCode::OK);

    let vault_a_file = app
        .clone()
        .oneshot(
            Request::builder()
                .uri("/file?vault_id=vault-a&path=notes%2Fshared.md")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        read_json(vault_a_file).await,
        json!({
            "path": "notes/shared.md",
            "hash": "b640e840b19d378660b32fb51ae18d67dccb4a8596a29e7bd72c1b2ae5928f41",
            "version": 1,
            "deleted": false,
            "content_b64": "Zmlyc3QK",
            "content_format": "plain"
        })
    );

    let vault_b_changes = app
        .oneshot(
            Request::builder()
                .uri("/changes?vault_id=vault-b&since=0")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(
        read_json(vault_b_changes).await,
        json!({
            "changes": [
                {
                    "seq": 2,
                    "device_id": "device_b",
                    "path": "notes/shared.md",
                    "version": 1,
                    "deleted": false
                }
            ],
            "latest_seq": 2
        })
    );
}

#[tokio::test]
async fn sync_flow_across_two_devices_surfaces_conflict_and_tombstone() {
    let (_tmp_dir, app) = test_app().await;

    let first_upload = upload_file(
        &app,
        "vault-a",
        "device-a",
        "notes/shared.md",
        "aGVsbG8K",
        "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
        0,
    )
    .await;
    assert_eq!(first_upload.status(), StatusCode::OK);
    assert_eq!(
        read_json(first_upload).await,
        json!({ "ok": true, "version": 1 })
    );

    let device_b_changes = get_changes(&app, "vault-a", 0).await;
    assert_eq!(device_b_changes.status(), StatusCode::OK);
    assert_eq!(
        read_json(device_b_changes).await,
        json!({
            "changes": [
                {
                    "seq": 1,
                    "device_id": "device-a",
                    "path": "notes/shared.md",
                    "version": 1,
                    "deleted": false
                }
            ],
            "latest_seq": 1
        })
    );

    let stale_upload = upload_file(
        &app,
        "vault-a",
        "device-b",
        "notes/shared.md",
        "d29ybGQK",
        "e258d248fda94c63753607f7c4494ee0fcbe92f1a76bfdac795c9d84101eb317",
        0,
    )
    .await;
    assert_eq!(stale_upload.status(), StatusCode::OK);
    assert_eq!(
        read_json(stale_upload).await,
        json!({
            "ok": false,
            "conflict": true,
            "server_version": 1
        })
    );

    let remote_file = get_file(&app, "vault-a", "notes/shared.md").await;
    assert_eq!(remote_file.status(), StatusCode::OK);
    assert_eq!(
        read_json(remote_file).await,
        json!({
            "path": "notes/shared.md",
            "hash": "5891b5b522d5df086d0ff0b110fbd9d21bb4fc7163af34d08286a2e846f6be03",
            "version": 1,
            "deleted": false,
            "content_b64": "aGVsbG8K",
            "content_format": "plain"
        })
    );

    let delete_response = delete_file(&app, "vault-a", "device-a", "notes/shared.md", 1).await;
    assert_eq!(delete_response.status(), StatusCode::OK);
    assert_eq!(
        read_json(delete_response).await,
        json!({ "ok": true, "version": 2 })
    );

    let tombstone_changes = get_changes(&app, "vault-a", 1).await;
    assert_eq!(tombstone_changes.status(), StatusCode::OK);
    assert_eq!(
        read_json(tombstone_changes).await,
        json!({
            "changes": [
                {
                    "seq": 2,
                    "device_id": "device-a",
                    "path": "notes/shared.md",
                    "version": 2,
                    "deleted": true
                }
            ],
            "latest_seq": 2
        })
    );

    let tombstone_file = get_file(&app, "vault-a", "notes/shared.md").await;
    assert_eq!(tombstone_file.status(), StatusCode::OK);
    assert_eq!(
        read_json(tombstone_file).await,
        json!({
            "path": "notes/shared.md",
            "hash": "",
            "version": 2,
            "deleted": true,
            "content_b64": null,
            "content_format": "plain"
        })
    );

    let devices_response = get_devices(&app, "vault-a").await;
    assert_eq!(devices_response.status(), StatusCode::OK);
    let devices_json = read_json(devices_response).await;
    assert_eq!(devices_json["devices"].as_array().unwrap().len(), 2);
    assert_eq!(devices_json["devices"][0]["device_id"], json!("device-a"));
    assert_eq!(devices_json["devices"][1]["device_id"], json!("device-b"));
    assert!(
        devices_json["devices"][0]["first_seen_at"]
            .as_str()
            .is_some()
    );
    assert!(
        devices_json["devices"][0]["last_seen_at"]
            .as_str()
            .is_some()
    );
}

async fn read_json(response: axum::response::Response) -> Value {
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

async fn upload_file(
    app: &axum::Router,
    vault_id: &str,
    device_id: &str,
    path: &str,
    content_b64: &str,
    hash: &str,
    base_version: i64,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/upload")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": vault_id,
                        "device_id": device_id,
                        "path": path,
                        "content_b64": content_b64,
                        "hash": hash,
                        "payload_hash": hash,
                        "content_format": "plain",
                        "base_version": base_version
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn delete_file(
    app: &axum::Router,
    vault_id: &str,
    device_id: &str,
    path: &str,
    base_version: i64,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/delete")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": vault_id,
                        "device_id": device_id,
                        "path": path,
                        "base_version": base_version
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn rename_file(
    app: &axum::Router,
    vault_id: &str,
    device_id: &str,
    from_path: &str,
    to_path: &str,
    base_version: i64,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/rename")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": vault_id,
                        "device_id": device_id,
                        "from_path": from_path,
                        "to_path": to_path,
                        "base_version": base_version
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn get_changes(app: &axum::Router, vault_id: &str, since: i64) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(format!("/changes?vault_id={vault_id}&since={since}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn get_file(app: &axum::Router, vault_id: &str, path: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/file?vault_id={vault_id}&path={}",
                    encode_query_value(path)
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn get_devices(app: &axum::Router, vault_id: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(format!("/devices?vault_id={vault_id}"))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn get_history(app: &axum::Router, vault_id: &str, path: &str) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .uri(format!(
                    "/history?vault_id={vault_id}&path={}",
                    encode_query_value(path)
                ))
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap()
}

async fn restore_file(
    app: &axum::Router,
    vault_id: &str,
    device_id: &str,
    path: &str,
    target_version: i64,
    base_version: i64,
) -> axum::response::Response {
    app.clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/restore")
                .header("content-type", "application/json")
                .body(Body::from(
                    json!({
                        "vault_id": vault_id,
                        "device_id": device_id,
                        "path": path,
                        "target_version": target_version,
                        "base_version": base_version
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap()
}

fn encode_query_value(value: &str) -> String {
    value.replace('/', "%2F")
}

fn sqlite_url(path: PathBuf) -> String {
    format!("sqlite://{}", path.display())
}
