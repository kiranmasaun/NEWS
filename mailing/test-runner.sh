#!/bin/bash

# Test Runner for News Mailing Lambda
# Usage: ./test-runner.sh [test-name]
# If no test name provided, runs all tests

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to run a single test
run_test() {
    local test_name=$1
    local mode=$2
    local event_file="events/${test_name}.json"
    
    if [ ! -f "$event_file" ]; then
        echo -e "${RED}❌ Test file not found: $event_file${NC}"
        return 1
    fi
    
    echo -e "${BLUE}🧪 Running test: $test_name (${mode})${NC}"
    echo "=================================================="
    
    # Run the test and capture output
    echo -e "${YELLOW}🚀 Invoking function...${NC}"
    local output_file="events/output/test-output-${test_name}-${mode}.txt"
    mkdir -p events/output
    
    if [ "$mode" = "remote" ]; then
        sam remote invoke News_Mailing_Prod_V11 --event-file "$event_file" --region us-west-2 > "$output_file" 2>&1
    else
        sam local invoke ContentMailingFunction --event "$event_file" --region us-west-2 > "$output_file" 2>&1
    fi
    local sam_exit_code=$?
    
    if [ $sam_exit_code -ne 0 ]; then
        echo -e "${RED}❌ SAM invocation failed: $test_name${NC}"
        cat "$output_file"
        return 1
    fi
    
    # Check for error patterns in the output
    local has_handler_error=0
    local has_400_status=0
    
    if grep -q "at exports.handler" "$output_file" 2>/dev/null; then
        has_handler_error=1
    fi
    
    if grep -q '{"statusCode": 400,' "$output_file" 2>/dev/null; then
        has_400_status=1
    fi
    local is_error_test=false
    
    # Determine if this is an expected error test
    if [[ "$test_name" == *"validation-errors"* ]]; then
        is_error_test=true
    fi
    
    # Classify the result
    local test_failed=false
    if [ "$has_handler_error" -gt 0 ] || [ "$has_400_status" -gt 0 ]; then
        # Found error indicators
        if [ "$is_error_test" = true ]; then
            echo -e "${BLUE}📊 Error detected as expected (validation test)${NC}"
            echo -e "${GREEN}✅ Test passed: $test_name${NC}"
        else
            echo -e "${RED}📊 Unexpected error found${NC}"
            echo -e "${RED}❌ Test failed: $test_name - Found error patterns${NC}"
            test_failed=true
        fi
    else
        # No error indicators found
        if [ "$is_error_test" = true ]; then
            echo -e "${RED}📊 Expected error but none found${NC}"
            echo -e "${RED}❌ Test failed: $test_name - Should have failed but didn't${NC}"
            test_failed=true
        else
            echo -e "${BLUE}📊 No errors detected${NC}"
            echo -e "${GREEN}✅ Test passed: $test_name${NC}"
            # Save successful output for review
            #cp "$output_file" "events/output/success-${test_name}.txt"
        fi
    fi
    
    if [ "$test_failed" = true ]; then
        echo -e "${YELLOW}Output preview:${NC}"
        head -10 "$output_file"
        return 1
    fi
    
    echo ""
}

# Function to run all tests
run_all_tests() {
    # Dynamically find all JSON files in events directory
    local test_files=($(find events -name "*.json" -type f 2>/dev/null | sort))
    local tests=()
    local failed_tests=()
    local passed_tests=()
    
    # Extract test names (remove events/ prefix and .json suffix)
    for file in "${test_files[@]}"; do
        local test_name=$(basename "$file" .json)
        tests+=("$test_name")
    done
    
    if [ ${#tests[@]} -eq 0 ]; then
        echo -e "${RED}❌ No test files found in events/ directory${NC}"
        return 1
    fi
    
    echo -e "${BLUE}🔄 Running all tests (${#tests[@]} found)...${NC}"
    echo ""
    
    for test in "${tests[@]}"; do
        if ! run_test "$test" "$1"; then
            failed_tests+=("$test")
        else
            passed_tests+=("$test")
        fi
    done
    
    echo "=================================================="
    echo -e "${BLUE}📊 Test Summary${NC}"
    echo "=================================================="
    
    if [ ${#failed_tests[@]} -eq 0 ]; then
        echo -e "${GREEN}🎉 All tests passed!${NC}"
        return 0
    else
        echo -e "${RED}❌ ${#failed_tests[@]} test(s) failed:${NC}"
        for failed_test in "${failed_tests[@]}"; do
            echo -e "${RED}  - $failed_test${NC}"
        done
        echo -e "${YELLOW}✅ ${#passed_tests[@]} test(s) passed:${NC}"
        for passed_test in "${passed_tests[@]}"; do
            echo -e "${GREEN}  - $passed_test${NC}"
        done
        echo -e "${YELLOW}Please review the output files in events/output/${NC}"
        echo "Run './test-runner.sh --help' for usage instructions."
        echo ""
        return 1
    fi
}

# Check if SAM is installed
if ! command -v sam &> /dev/null; then
    echo -e "${RED}❌ SAM CLI not found. Please install AWS SAM CLI first.${NC}"
    echo "Installation guide: https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html"
    exit 1
fi

# Check if we're in the right directory
if [ ! -f "template.yml" ]; then
    echo -e "${RED}❌ template.yml not found. Please run this script from the lambda function directory.${NC}"
    exit 1
fi

# Main execution
if [ $# -eq 0 ]; then
    # No arguments, run all tests locally
    run_all_tests "local"
elif [ "$1" = "local" ] || [ "$1" = "remote" ]; then
    if [ $# -eq 1 ]; then
        # Run all tests with specified mode
        run_all_tests "$1"
    else
        # Run specific test with specified mode
        run_test "$2" "$1"
    fi
elif [ "$1" = "--help" ] || [ "$1" = "-h" ]; then
    echo "Test Runner for News Mailing Lambda"
    echo ""
    echo "Usage:"
    echo "  ./test-runner.sh                    # Run all tests locally"
    echo "  ./test-runner.sh local              # Run all tests locally"
    echo "  ./test-runner.sh remote             # Run all tests on deployed function"
    echo "  ./test-runner.sh local [test-name]  # Run specific test locally"
    echo "  ./test-runner.sh remote [test-name] # Run specific test on deployed function"
    echo "  ./test-runner.sh --help             # Show this help"
    echo ""


    # Build the function first
    echo -e "${YELLOW}📦 Building function...${NC}"
    sam build
    
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✅ Build successful${NC}"
    else
        echo -e "${RED}❌ Build failed${NC}"
        return 1
    fi


    echo "Available tests:"
    # Dynamically list available tests
    local test_files=($(find events -name "*.json" -type f 2>/dev/null | sort))
    if [ ${#test_files[@]} -eq 0 ]; then
        echo "  No test files found in events/ directory"
    else
        for file in "${test_files[@]}"; do
            local test_name=$(basename "$file" .json)
            echo "  $test_name"
        done
    fi
    echo ""
    echo "Examples:"
    # Show examples with actual test names if available
    local test_files=($(find events -name "*.json" -type f 2>/dev/null | sort | head -2))
    if [ ${#test_files[@]} -gt 0 ]; then
        for file in "${test_files[@]}"; do
            local test_name=$(basename "$file" .json)
            echo "  ./test-runner.sh $test_name"
        done
    else
        echo "  ./test-runner.sh your-test-name"
    fi
else
    # Run specific test locally (backwards compatibility)
    run_test "$1" "local"
fi