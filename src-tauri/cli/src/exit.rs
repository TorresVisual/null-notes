use crate::client::ClientError;
use crate::protocol::ErrorCode;

pub fn code_for(error: &ClientError) -> i32 {
    match error {
        ClientError::Disabled => 6,
        ClientError::Unreachable(_) => 4,
        ClientError::Rejected(body) => match body.code {
            ErrorCode::Failed => 1,
            ErrorCode::Usage => 2,
            ErrorCode::DirtyBuffer => 5,
            ErrorCode::VersionMismatch | ErrorCode::Unauthorized => 7,
        },
    }
}

pub fn message_for(error: &ClientError) -> String {
    match error {
        ClientError::Disabled => "CLI access is turned off in Null Notes (Settings → Tools)".into(),
        ClientError::Unreachable(reason) => reason.clone(),
        ClientError::Rejected(body) => body.message.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::ErrorBody;

    fn rejected(code: ErrorCode) -> ClientError {
        ClientError::Rejected(ErrorBody {
            code,
            message: String::new(),
        })
    }

    #[test]
    fn message_for_covers_every_variant() {
        assert_eq!(
            message_for(&ClientError::Disabled),
            "CLI access is turned off in Null Notes (Settings → Tools)"
        );
        assert_eq!(
            message_for(&ClientError::Unreachable("gone".into())),
            "gone"
        );
        let body = ErrorBody {
            code: ErrorCode::Failed,
            message: "nope".into(),
        };
        assert_eq!(message_for(&ClientError::Rejected(body)), "nope");
    }

    #[test]
    fn every_error_maps_to_its_documented_exit_code() {
        assert_eq!(code_for(&rejected(ErrorCode::Failed)), 1);
        assert_eq!(code_for(&rejected(ErrorCode::Usage)), 2);
        assert_eq!(code_for(&ClientError::Unreachable("x".into())), 4);
        assert_eq!(code_for(&rejected(ErrorCode::DirtyBuffer)), 5);
        assert_eq!(code_for(&ClientError::Disabled), 6);
        assert_eq!(code_for(&rejected(ErrorCode::VersionMismatch)), 7);
        assert_eq!(code_for(&rejected(ErrorCode::Unauthorized)), 7);
    }
}
