#!/bin/sh
# Print the request investigate-task works from. The skill runs this before its
# subagent starts, because the subagent has no shell.
#
# Usage: fetch-issue.sh <first argument of the skill>
case "$1" in
  '') echo 'NO INPUT' ;;
  *[!0-9]*) echo 'No issue fetched: the first argument is not an issue number.' ;;
  *) gh issue view "$1" --json number,title,body,comments ;;
esac
