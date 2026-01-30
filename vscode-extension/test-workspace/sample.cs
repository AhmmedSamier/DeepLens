using Microsoft.AspNetCore.Mvc;

[ApiController]
[Route("api/[controller]")]
class UsersController : ControllerBase {
    [HttpGet]
    public IActionResult GetAll() {
        return Ok();
    }

    [HttpPost("{id}")]
    public IActionResult Update(int id) {
        return Ok();
    }
}
