"""Create a fresh local TEAM identity database; never starts the application."""

import argparse
import getpass
from pathlib import Path

from trialboard.api.team_auth import bootstrap_identity_database


def main() -> None:
    parser = argparse.ArgumentParser(description="Create a fresh TrialBoard TEAM identity DB")
    parser.add_argument("--identity-db", type=Path, required=True)
    parser.add_argument("--username", required=True)
    parser.add_argument("--team-name", required=True)
    args = parser.parse_args()
    password = getpass.getpass("New password (hidden): ")
    confirmation = getpass.getpass("Confirm password (hidden): ")
    if password != confirmation:
        parser.error("passwords do not match")
    try:
        bootstrap_identity_database(
            args.identity_db, username=args.username, password=password, team_name=args.team_name
        )
    except ValueError as error:
        parser.error(str(error))
    print("TEAM identity database created; no server was started.")


if __name__ == "__main__":
    main()
