use std::path::PathBuf;

use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use http_body_util::BodyExt;
use obsidian_sync_server::{app, db, state::AppState};
use serde_json::{json, Value};
use tempfile::TempDir;
use tower::util::ServiceExt;

#[tokio::test]
async fn health_returns_ok() {
    let (_tmp_dir, app) = test_app().await;

    let response = app
        .oneshot(Request::builder().uri("/health").body(Body::empty()).unwrap())
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
                        "base_version": 0
                    })
                    .to_string(),
                ))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(upload_response.status(), StatusCode::OK);
    assert_eq!(read_json(upload_response).await, json!({ "ok": true, "version": 1 }));

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
            "content_b64": "aGVsbG8K"
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
    assert_eq!(read_json(delete_response).await, json!({ "ok": true, "version": 2 }));

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
            "content_b64": null
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

async fn test_app() -> (TempDir, axum::Router) {
    test_app_with_token("").await
}

async fn test_app_with_token(token: &str) -> (TempDir, axum::Router) {
    let temp_dir = TempDir::new().unwrap();
    let database_url = sqlite_url(temp_dir.path().join("sync.db"));
    let storage_root = temp_dir.path().join("files");

    let pool = db::connect(&database_url).await.unwrap();
    db::migrate(&pool).await.unwrap();

    let auth_token = if token.is_empty() {
        None
    } else {
        Some(token.to_string())
    };
    let state = AppState::new(pool, storage_root, auth_token);
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
            "content_b64": "Zmlyc3QK"
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

async fn read_json(response: axum::response::Response) -> Value {
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

fn sqlite_url(path: PathBuf) -> String {
    format!("sqlite://{}", path.display())
}
