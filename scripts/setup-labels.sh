#!/bin/bash

# 🏷️ GitHub Labels Setup Script
#
# Este script cria um conjunto de labels padrão para o repositório.
# Requer GitHub CLI (gh) instalado e autenticado.

set -e

# Check for gh
if ! command -v gh &> /dev/null; then
    echo "GitHub CLI (gh) not found. Please install it to continue."
    exit 1
fi

# Check for auth
if ! gh auth status &> /dev/null; then
    echo "Not authenticated with GitHub. Please run 'gh auth login'."
    exit 1
fi

create_label() {
    local name=$1
    local description=$2
    local color=$3
    gh label create "$name" --description "$description" --color "$color" --force
}

echo "Creating TYPE labels..."
create_label "type: bug" "Bug or error in code" "d73a4a"
create_label "type: feature" "New feature or enhancement" "0e8a16"
create_label "type: docs" "Documentation updates" "0075ca"
create_label "type: chore" "Maintenance tasks" "fef2c0"

echo "Creating PRIORITY labels..."
create_label "priority: high" "High priority" "b60205"
create_label "priority: medium" "Medium priority" "fbca04"
create_label "priority: low" "Low priority" "0e8a16"

echo "Creating STATUS labels..."
create_label "status: todo" "Ready to start" "fbca04"
create_label "status: in-progress" "Work in progress" "1d76db"
create_label "status: done" "Completed" "0e8a16"

echo "Labels setup complete!"
