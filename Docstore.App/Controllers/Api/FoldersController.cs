using AutoMapper;
using Docstore.App.Models.Forms;
using Docstore.Application.Interfaces;
using Docstore.Application.Models.DTO;
using Docstore.Domain.Entities;
using Docstore.Persistence.Contexts;
using Microsoft.AspNetCore.Mvc;

// For more information on enabling Web API for empty projects, visit https://go.microsoft.com/fwlink/?LinkID=397860

namespace Docstore.App.Controllers.Api
{
    [Route("api/[controller]")]
    [ApiController]
    public class FoldersController : ControllerBase
    {
        private readonly IMapper _mapper;
        private readonly IFolderRepository _folderRepository;
        private readonly AppDbContext _context;

        public FoldersController(IMapper mapper, IFolderRepository folderRepository, AppDbContext context)
        {
            _folderRepository = folderRepository;
            _mapper = mapper;
            _context = context;
        }


        #region actions
        [HttpGet]
        public async Task<ActionResult<IEnumerable<GetFolderDto>>> Get(string? search = null)
        {
            if (string.IsNullOrWhiteSpace(search))
                return new List<GetFolderDto>();

            var folders = await _folderRepository.SearchAsync(search);
            var dto = _mapper.Map<IEnumerable<GetFolderDto>>(folders);

            return dto.ToList();
        }

        [HttpGet("{id}")]
        public async Task<ActionResult<GetFolderDto>> Get(int id)
        {
            var folder = await _folderRepository.FindByIdAsync(id);

            if(folder == null)
                return NotFound();

            var dto = _mapper.Map<GetFolderDto>(folder);
            return dto;
        }

        [HttpPost]
        public async Task<ActionResult<Folder>> Post([FromBody] FolderCreateForm form)
        {
            // model validation
            try
            {
                if (ModelState.IsValid && form != null)
                {
                    // transform to database entity
                    var folder = _mapper.Map<Folder>(form);

                    // save in database
                    await _folderRepository.AddAsync(folder);
                    await _context.SaveChangesAsync();

                    // response
                    return CreatedAtAction("Get", new { id = folder.Id }, folder);  
                }
            }
            catch// (Exception ex)
            {
                ModelState.AddModelError("", "An unexpected error occurred.");
            }

            // is not supposed to get here
            return StatusCode(StatusCodes.Status500InternalServerError);
        }
        #endregion
    }
}
