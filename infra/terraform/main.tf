############################################################
# Placeholder — not part of the take-home scope.
# The production stack lives in a separate private repo.
############################################################

terraform {
  required_version = ">= 1.6"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}
