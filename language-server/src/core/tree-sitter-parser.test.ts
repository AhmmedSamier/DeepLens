import { describe, expect, it, mock } from 'bun:test';
import * as fs from 'fs';
import * as path from 'path';

// Mock vscode
mock.module('vscode', () => ({
    Uri: {
        file: (p: string) => ({ fsPath: p, scheme: 'file' }),
    },
    workspace: {
        asRelativePath: (p: string) => p,
    },
}));

import { TreeSitterParser } from './tree-sitter-parser';
import { SearchItemType } from './types';

describe('TreeSitterParser', () => {
    const extensionPath = path.resolve(__dirname, '../../');
    const parser = new TreeSitterParser(extensionPath);

    it('should detect ASP.NET endpoints in C# code', async () => {
        await parser.init();

        // Create a temporary C# file
        const testFilePath = path.join(__dirname, 'TestController.auto.cs');
        const csharpCode = `
using Microsoft.AspNetCore.Mvc;

namespace WebAPI.Controllers
{
    [Route("api/[controller]")]
    [ApiController]
    public class AdminDashboardController : ControllerBase
    {
        [HttpGet("{year}")]
        public IActionResult GetRevenueSummary(int year)
        {
            return Ok();
        }

        [HttpGet("customers")]
        public IActionResult GetAllCustomers([FromQuery] string filter)
        {
            return Ok();
        }

        [HttpPut("customers/{companyId}/{employeeId}/username")]
        public IActionResult ChangeEmployeeUsername(int companyId, int employeeId)
        {
            return NoContent();
        }
    }
}
        `;
        fs.writeFileSync(testFilePath, csharpCode);

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = await parser.parseFile(testFilePath);

            const endpoints = items.filter((item) => item.type === SearchItemType.ENDPOINT);

            console.log(
                'Detected Endpoints:',
                endpoints.map((e) => e.name),
            );

            expect(endpoints.length).toBeGreaterThan(0);

            // Check specific endpoints
            const getRevenue = endpoints.find((e) => e.fullName!.includes('GetRevenueSummary'));
            expect(getRevenue).toBeDefined();
            expect(getRevenue?.name).toContain('api/AdminDashboard/{year}');

            const getAllCustomers = endpoints.find((e) => e.fullName!.includes('GetAllCustomers'));
            expect(getAllCustomers).toBeDefined();
            expect(getAllCustomers?.name).toContain('api/AdminDashboard/customers');

            const changeUsername = endpoints.find((e) => e.fullName!.includes('ChangeEmployeeUsername'));
            expect(changeUsername).toBeDefined();
            expect(changeUsername?.name).toContain('api/AdminDashboard/customers/{companyId}/{employeeId}/username');
        } finally {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        }
    });

    it("should detect endpoints in the user's provided controller", async () => {
        await parser.init();

        const testFilePath = path.join(__dirname, 'UserDashboardController.auto.cs');
        const csharpCode = `
using Helpers;
using Microsoft.AspNetCore.Mvc;

namespace WebAPI.Controllers.AdminDashboard
{
    [Route("api/[controller]")]
    [ApiController]
    public class AdminDashboardController : AdminBaseController
    {
        [HttpGet("{year}")]
        public IActionResult GetRevenueSummary(int year)
        {
            return Ok();
        }

        [HttpGet("customers")]
        public IActionResult GetAllCustomers([FromQuery] string filter)
        {
            return Ok();
        }
    }
}
        `;
        fs.writeFileSync(testFilePath, csharpCode);

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = await parser.parseFile(testFilePath);

            const endpoints = items.filter((item) => item.type === SearchItemType.ENDPOINT);

            console.log(
                'User Controller Endpoints:',
                endpoints.map((e) => e.name),
            );

            expect(endpoints.length).toBe(2);
            expect(endpoints[0].name).toContain('api/AdminDashboard/{year}');
            expect(endpoints[1].name).toContain('api/AdminDashboard/customers');
        } finally {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        }
    });

    it('should handle multiple attribute lists', async () => {
        await parser.init();

        const testFilePath = path.join(__dirname, 'MultiAttrController.auto.cs');
        const csharpCode = `
using Microsoft.AspNetCore.Mvc;

[Route("api/test")]
[ApiController]
public class MultiAttrController
{
    [HttpPost]
    [Route("upload")]
    public void Upload() {}
}
        `;
        fs.writeFileSync(testFilePath, csharpCode);

        try {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const items = await parser.parseFile(testFilePath);

            const endpoints = items.filter((item) => item.type === SearchItemType.ENDPOINT);

            console.log(
                'MultiAttr Endpoints:',
                endpoints.map((e) => e.name),
            );

            // It should detect the endpoint.
            // Depending on implementation, it might be [POST] api/test/upload or [ROUTE] api/test/upload
            expect(endpoints.length).toBeGreaterThan(0);
            expect(endpoints[0].name).toContain('api/test/upload');
        } finally {
            if (fs.existsSync(testFilePath)) {
                fs.unlinkSync(testFilePath);
            }
        }
    });
});
