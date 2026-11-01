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
